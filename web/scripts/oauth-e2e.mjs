// End-to-end OAuth run against a live Lowtide (next dev or the deployed site) with the MCP TypeScript SDK's own
// OAuth client and a real browser on the consent page.
//
//   PLAYWRIGHT=/path/to/node_modules/playwright node scripts/oauth-e2e.mjs [baseUrl] [shotsDir]
//
// 1. A fresh client connects to /api/mcp/account, gets 401 + resource_metadata, discovers the protected resource
//    and the authorization server, registers (RFC 7591), and is sent to the consent page.
// 2. Playwright makes a new household on the consent page and allows; the SDK exchanges the code (PKCE S256).
// 3. tools/list, plan_appliance and schedule_run with the household token.
// 4. A second client links an *existing* household (made through /api/homes) by pasting its link; the run it
//    saves shows up through the household's capability link, which keeps working unchanged.
// 5. Refresh: the SDK's access token is spoiled, the server answers 401, the SDK refreshes and retries.
// 6. Revocation: the refresh token is revoked; the next call can't get a token any more.
// 7. client_credentials (Alexa+ Tier 1): a confidential client gets mcp:service, reads guest tools, and is refused
//    the household's tools with 403 insufficient_scope.
// 8. The guest endpoint /api/mcp still answers without a token.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { Client, ClientCredentialsProvider, StreamableHTTPClientTransport, UnauthorizedError } from "@modelcontextprotocol/client";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const base = (process.argv[2] || "http://localhost:3517").replace(/\/$/, "");
const shots = process.argv[3];
if (shots) mkdirSync(shots, { recursive: true });
const account = new URL(`${base}/api/mcp/account`);
const CALLBACK = "http://127.0.0.1:8976/callback";
let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) failures++;
};

/** An OAuthClientProvider that keeps everything in memory, as a CLI client would for one run. */
class MemoryProvider {
  constructor(name) {
    this.name = name;
    this.info = undefined;
    this.saved = undefined;
    this.verifier = undefined;
    this.discovery = undefined;
    this.authUrl = undefined;
    this.events = [];
  }
  get redirectUrl() {
    return CALLBACK;
  }
  get clientMetadata() {
    return { client_name: this.name, redirect_uris: [CALLBACK], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" };
  }
  state() {
    return "e2e-" + Math.random().toString(36).slice(2);
  }
  clientInformation() {
    return this.info;
  }
  saveClientInformation(info) {
    this.events.push("registered");
    this.info = info;
  }
  tokens() {
    return this.saved;
  }
  saveTokens(t) {
    this.events.push(this.saved ? "refreshed" : "tokens");
    this.saved = t;
  }
  redirectToAuthorization(url) {
    this.authUrl = url;
  }
  saveCodeVerifier(v) {
    this.verifier = v;
  }
  codeVerifier() {
    return this.verifier;
  }
  saveDiscoveryState(s) {
    this.discovery = s;
  }
  discoveryState() {
    return this.discovery;
  }
  invalidateCredentials(scope) {
    this.events.push(`invalidated:${scope}`);
    if (scope === "all" || scope === "tokens") this.saved = undefined;
    if (scope === "all" || scope === "client") this.info = undefined;
  }
}

/** Connects; on the first 401 drives the consent page in the browser, finishes the exchange, connects again. */
async function signIn(browser, provider, choose, shotName) {
  const first = new StreamableHTTPClientTransport(account, { authProvider: provider });
  const client = new Client({ name: provider.name, version: "1.0.0" });
  try {
    await client.connect(first);
    throw new Error("connected without signing in");
  } catch (e) {
    if (!(e instanceof UnauthorizedError) && !String(e).includes("Unauthorized")) throw e;
  }
  check(Boolean(provider.authUrl), `${provider.name}: discovered the authorization server and was sent to ${provider.authUrl?.pathname}`);
  check(provider.events.includes("registered") && /^ltc/.test(provider.info?.client_id ?? ""), `${provider.name}: registered dynamically (${provider.info?.client_id?.slice(0, 8)}...)`);
  const u = provider.authUrl;
  check(u.searchParams.get("code_challenge_method") === "S256" && Boolean(u.searchParams.get("code_challenge")), `${provider.name}: authorization request carries a PKCE S256 challenge`);
  check(u.searchParams.get("resource") === `${base}/api/mcp/account`, `${provider.name}: resource indicator is the MCP server (${u.searchParams.get("resource")})`);

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let callback = null;
  // nothing listens on the callback port: the browser's request for it is the redirect we wait for
  page.on("request", (r) => {
    if (r.url().startsWith(CALLBACK)) callback = new URL(r.url());
  });
  await page.goto(u.toString(), { waitUntil: "load" });
  const heading = (await page.locator("h1").innerText()).replace(/\s+/g, " ");
  check(heading === `Let ${provider.name} plan your household's appliance runs?` || heading === `Let ${provider.name} plan your household’s appliance runs?`, `consent page asks: "${heading}"`);
  await choose(page);
  if (shots) await page.screenshot({ path: path.join(shots, `${shotName}.png`), fullPage: true });
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  // the first consent in `next dev` compiles the route and looks the tariff up live, so allow a while
  for (let i = 0; i < 600 && !callback; i++) await page.waitForTimeout(100);
  if (!callback) console.log("  stuck at", page.url(), (await page.locator("[role=alert]").allInnerTexts().catch(() => [])).join(" "));
  await page.close();
  check(Boolean(callback?.searchParams.get("code")), `${provider.name}: redirected back with a code`);
  check(callback?.searchParams.get("iss") === base, `${provider.name}: redirect carries iss=${callback?.searchParams.get("iss")} (RFC 9207)`);
  await first.finishAuth(callback.searchParams);
  check(provider.saved?.token_type === "Bearer" && /^lta_/.test(provider.saved?.access_token ?? "") && /^ltr_/.test(provider.saved?.refresh_token ?? ""), `${provider.name}: exchanged the code for an access and a refresh token (expires_in ${provider.saved?.expires_in}, scope "${provider.saved?.scope}")`);

  const signedIn = new Client({ name: provider.name, version: "1.0.0" });
  await signedIn.connect(new StreamableHTTPClientTransport(account, { authProvider: provider }));
  return signedIn;
}

const text = (r) => r.content.map((c) => c.text).join(" | ");

const browser = await chromium.launch({ headless: true });
try {
  // 1-3: a new household from the consent page
  const a = new MemoryProvider("Lowtide e2e (new household)");
  const ca = await signIn(
    browser,
    a,
    async (page) => {
      await page.getByRole("textbox", { name: "Postcode or city" }).fill("SW1A 2AA");
    },
    "consent-new",
  );
  check(ca.getNegotiatedProtocolVersion?.() !== undefined, `connected with the token (protocol ${ca.getNegotiatedProtocolVersion?.()})`);
  const { tools } = await ca.listTools();
  check(tools.length >= 9, `tools/list: ${tools.length} tools (${tools.map((t) => t.name).join(", ")})`);
  const plan = await ca.callTool({ name: "plan_appliance", arguments: { appliance: "dishwasher" } });
  check(!plan.isError, `plan_appliance: ${text(plan).slice(0, 140)}...`);
  const start = text(plan).match(/start "([^"]+)"/)?.[1];
  const saved = await ca.callTool({ name: "schedule_run", arguments: { appliance: "dishwasher", start } });
  check(/^Saved\./.test(text(saved)), `schedule_run in the new household: ${text(saved).slice(0, 100)}...`);
  const runs = await ca.callTool({ name: "list_runs", arguments: {} });
  check(/one run planned/.test(text(runs)), `list_runs: ${text(runs).slice(0, 100)}`);

  // 4: an existing household, picked by pasting its link
  const home = await fetch(`${base}/api/homes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ place: "Germany" }) }).then((r) => r.json());
  const b = new MemoryProvider("Lowtide e2e (existing household)");
  const cb = await signIn(
    browser,
    b,
    async (page) => {
      await page.getByText("One I already have").click();
      await page.getByRole("textbox", { name: "Household link" }).fill(home.mcpUrl);
    },
    "consent-existing",
  );
  const planB = await cb.callTool({ name: "plan_appliance", arguments: { appliance: "washing machine" } });
  const startB = text(planB).match(/start "([^"]+)"/)?.[1];
  const savedB = await cb.callTool({ name: "schedule_run", arguments: { appliance: "washing machine", start: startB } });
  check(/^Saved\./.test(text(savedB)), `schedule_run through OAuth in the pasted household: ${text(savedB).slice(0, 90)}...`);
  const link = new Client({ name: "capability-link", version: "1.0.0" });
  await link.connect(new StreamableHTTPClientTransport(new URL(home.mcpUrl)));
  const viaLink = await link.callTool({ name: "list_runs", arguments: {} });
  check(/washing machine/.test(text(viaLink)), `the household's capability link (unchanged) sees the OAuth-saved run: ${text(viaLink).slice(0, 90)}`);
  await link.close();

  // 5: refresh, driven by the SDK after a 401
  const before = b.saved.refresh_token;
  b.saved = { ...b.saved, access_token: "lta_spoiled" };
  const afterRefresh = await cb.callTool({ name: "get_tide", arguments: {} });
  check(!afterRefresh.isError && b.events.includes("refreshed") && b.saved.refresh_token !== before, "refresh: a 401 on a spoiled token made the SDK refresh (rotated refresh token) and retry");

  // 6: revocation of the refresh token ends the grant
  const rv = await fetch(`${base}/api/oauth/revoke`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: b.saved.refresh_token, client_id: b.info.client_id }) });
  check(rv.status === 200, `revoke: HTTP ${rv.status}`);
  let revokedOut = false;
  try {
    const r = await cb.callTool({ name: "list_runs", arguments: {} });
    revokedOut = Boolean(r.isError);
  } catch {
    revokedOut = true;
  }
  check(revokedOut, "after revocation the household's access token no longer works and can't be refreshed");
  await cb.close().catch(() => {});
  await ca.close();

  // 7: client_credentials (Alexa+ Tier 1), registered as a confidential client
  const reg = await fetch(`${base}/api/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Alexa+ service (e2e)", grant_types: ["client_credentials"], token_endpoint_auth_method: "client_secret_basic" }) }).then((r) => r.json());
  check(/^ltc/.test(reg.client_id) && /^lts_/.test(reg.client_secret ?? ""), "registered a confidential client_credentials client (secret shown once, not printed)");
  const svc = new ClientCredentialsProvider({ clientId: reg.client_id, clientSecret: reg.client_secret, expectedIssuer: base, scope: "mcp:service" });
  const cs = new Client({ name: "alexa-service", version: "1.0.0" });
  await cs.connect(new StreamableHTTPClientTransport(account, { authProvider: svc }));
  const svcTok = svc.tokens();
  check(svcTok?.scope === "mcp:service" && !svcTok?.refresh_token && svcTok?.expires_in <= 3600, `client_credentials token: scope ${svcTok?.scope}, expires_in ${svcTok?.expires_in}, refresh_token ${svcTok?.refresh_token ? "present" : "none"}`);
  check((await cs.listTools()).tools.length >= 9, "service token: tools/list works");
  const tide = await cs.callTool({ name: "get_tide", arguments: { place: "Germany" } });
  check(!tide.isError, `service token: a guest tool works: ${text(tide).slice(0, 80)}...`);
  const raw = await fetch(account, {
    method: "POST",
    headers: { authorization: `Bearer ${svcTok.access_token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "list_runs", arguments: {} } }),
  });
  check(raw.status === 403 && /insufficient_scope/.test(raw.headers.get("www-authenticate") ?? ""), `service token: a household tool is refused (HTTP ${raw.status}, ${raw.headers.get("www-authenticate")?.match(/error="[^"]+"/)?.[0]})`);
  await cs.close();

  // 8: the guest endpoint, no token
  const guest = new Client({ name: "guest", version: "1.0.0" });
  await guest.connect(new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`)));
  const g = await guest.callTool({ name: "check_now", arguments: { place: "Germany" } });
  check(!g.isError, `guest /api/mcp without a token: ${text(g).slice(0, 80)}...`);
  await guest.close();
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exitCode = failures ? 1 : 0;
