/**
 * Lowtide's OAuth 2.1 authorization server and the MCP endpoint behind it: PKCE, code exchange, refresh
 * rotation and replay, revocation, client_credentials, and the household and resource a token is bound to.
 * The store is an in-memory stand-in with S3's If-Match semantics; the network is a stubbed fetch.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Storage } from "../lib/storage";

const ORIGINAL_CWD = process.cwd();
const TMP = mkdtempSync(path.join(tmpdir(), "lowtide-oauth-"));
process.chdir(TMP);
for (const k of ["BLOB_READ_WRITE_TOKEN", "S3_BUCKET", "GCS_BUCKET", "MCP_AUTH"]) delete process.env[k];
process.on("exit", () => {
  process.chdir(ORIGINAL_CWD);
  rmSync(TMP, { recursive: true, force: true });
});

const HOUR = 3600_000;
const BASE = Math.floor(Date.now() / HOUR) * HOUR;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("https://api.awattar.de/")) {
    const data = [];
    for (let h = -3; h < 24; h++) data.push({ start_timestamp: BASE + h * HOUR, end_timestamp: BASE + (h + 1) * HOUR, marketprice: (h === 5 ? 2 : 30) * 10, unit: "Eur/MWh" });
    return Response.json({ data });
  }
  if (url.startsWith(ORIGIN)) return route(input instanceof Request ? input : new Request(url, init));
  return realFetch(input, init);
}) as typeof fetch;

/** S3 in miniature: every write gets a new ETag, and If-Match on a stale one fails as S3's 412 does. */
const objects = new Map<string, { text: string; etag: string }>();
let version = 0;
const memory: Storage = {
  async read(key) {
    return objects.get(key) ?? null;
  },
  async write(key, text, opts = {}) {
    const cur = objects.get(key);
    if (opts.ifMatch !== undefined && cur?.etag !== opts.ifMatch) throw new Error(`S3 write ${key}: the object changed since it was read`);
    objects.set(key, { text, etag: `"v${++version}"` });
  },
  async list(prefix) {
    return [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
  },
};

const ORIGIN = "http://lowtide.test";
const OTHER = "https://elsewhere.example";
const RESOURCE = `${ORIGIN}/api/mcp`;

const { setStorageForTests } = await import("../lib/storage");
setStorageForTests(memory);
const { pkceMatches, sha256b64url, random } = await import("../lib/oauth/crypto");
const { registerClient } = await import("../lib/oauth/clients");
const { checkAuthorize, issueCode, homeIdFrom } = await import("../lib/oauth/authorize");
const { tokenRequest, revokeRequest, verifyAccessToken } = await import("../lib/oauth/tokens");
const { OAuthError } = await import("../lib/oauth/http");
const { serverMetadata, resourceMetadata } = await import("../lib/oauth/config");
const { fetchMetadataDocument, isPrivateAddress, clearMetadataCacheForTests } = await import("../lib/oauth/cimd");
const { protectedMcp } = await import("../lib/oauth/resource");
const { createHome, loadHome } = await import("../lib/store");
const { Client, StreamableHTTPClientTransport } = await import("@modelcontextprotocol/client");

let route: (req: Request) => Promise<Response> = async (req) => {
  const p = new URL(req.url).pathname;
  if (p === "/api/mcp/account") return protectedMcp(req, { path: p, required: true });
  if (p === "/api/mcp") return protectedMcp(req, { path: p, required: false });
  return new Response("not found", { status: 404 });
};

const REDIRECT = "https://app.example/callback";
const form = (o: Record<string, string>, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/api/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(o) });
const basic = (id: string, secret: string) => ({ authorization: `Basic ${Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString("base64")}` });

async function oauthError(p: Promise<unknown>): Promise<InstanceType<typeof OAuthError>> {
  try {
    await p;
  } catch (e) {
    if (e instanceof OAuthError) return e;
    throw e;
  }
  assert.fail("expected an OAuth error");
}

async function publicClient() {
  return (await registerClient({ client_name: "Test app", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"] })).client;
}

/** Runs the authorization endpoint for a fresh household and returns the code and the verifier that goes with it. */
async function authorize(clientId: string, extra: Record<string, string> = {}) {
  const verifier = random(48);
  const checked = await checkAuthorize(
    { response_type: "code", client_id: clientId, redirect_uri: REDIRECT, state: "s1", code_challenge: sha256b64url(verifier), code_challenge_method: "S256", resource: RESOURCE, ...extra },
    ORIGIN,
  );
  assert.equal(checked.kind, "ok");
  if (checked.kind !== "ok") throw new Error("unreachable");
  const home = (await createHome("Berlin", "DE")).home.id;
  const back = new URL(await issueCode(checked.request, home, ORIGIN));
  assert.equal(back.searchParams.get("state"), "s1");
  assert.equal(back.searchParams.get("iss"), ORIGIN);
  return { code: back.searchParams.get("code")!, verifier, home };
}

async function signedIn() {
  const client = await publicClient();
  const { code, verifier, home } = await authorize(client.client_id);
  const tokens = await tokenRequest(form({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: REDIRECT, client_id: client.client_id, resource: RESOURCE }), ORIGIN);
  return { client, tokens, home };
}

/* ───────────── PKCE ───────────── */

test("PKCE: the RFC 7636 appendix B vector, and nothing else, matches", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  assert.equal(pkceMatches(verifier, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"), true);
  assert.equal(pkceMatches(verifier.replace(/.$/, "R"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"), false);
  assert.equal(pkceMatches("short", sha256b64url("short")), false, "verifiers under 43 characters are refused");
  assert.equal(pkceMatches(verifier, verifier), false, "plain (challenge = verifier) is not S256");
});

test("authorize: S256 is required; plain, a missing challenge, a foreign resource and user-less scopes go back as errors", async () => {
  const client = await publicClient();
  const base = { response_type: "code", client_id: client.client_id, redirect_uri: REDIRECT, state: "x", code_challenge: sha256b64url(random(48)), code_challenge_method: "S256" };
  const errorOf = async (p: Record<string, string | undefined>) => {
    const c = await checkAuthorize(p, ORIGIN);
    assert.equal(c.kind, "error");
    return c.kind === "error" ? new URL(c.redirect).searchParams : new URLSearchParams();
  };
  assert.equal((await errorOf({ ...base, code_challenge_method: "plain" })).get("error"), "invalid_request");
  assert.equal((await errorOf({ ...base, code_challenge: undefined })).get("error"), "invalid_request");
  assert.equal((await errorOf({ ...base, response_type: "token" })).get("error"), "unsupported_response_type");
  assert.equal((await errorOf({ ...base, resource: `${OTHER}/mcp` })).get("error"), "invalid_target");
  assert.equal((await errorOf({ ...base, scope: "mcp:service" })).get("error"), "invalid_scope");
  const ok = await checkAuthorize({ ...base, scope: "mcp:tools mcp:service openid" }, ORIGIN);
  assert.equal(ok.kind, "ok");
  if (ok.kind === "ok") assert.deepEqual(ok.request.scope, ["mcp:tools"], "mcp:service and unknown scopes are dropped from a household grant");
  assert.equal((await checkAuthorize(base, ORIGIN)).kind, "ok", "a valid request is not an error");
});

test("authorize: an unknown client or an unregistered redirect URI is never redirected to", async () => {
  const client = await publicClient();
  const base = { response_type: "code", code_challenge: sha256b64url(random(48)), code_challenge_method: "S256" };
  assert.equal((await checkAuthorize({ ...base, client_id: "ltcaaaaaaaaaaaaaaaaaaaa", redirect_uri: REDIRECT }, ORIGIN)).kind, "fatal");
  assert.equal((await checkAuthorize({ ...base, client_id: client.client_id, redirect_uri: "https://attacker.example/cb" }, ORIGIN)).kind, "fatal");
  assert.equal((await checkAuthorize({ ...base, client_id: client.client_id }, ORIGIN)).kind, "ok", "the one registered redirect URI is used when none is sent");
});

/* ───────────── Code exchange ───────────── */

test("code exchange: a verifier that matches gets a household token and a refresh token; the token acts for that household", async () => {
  const { client, tokens, home } = await signedIn();
  assert.equal(tokens.token_type, "Bearer");
  assert.ok(tokens.expires_in <= 3600);
  assert.equal(tokens.scope, "mcp:tools mcp:resources");
  assert.match(tokens.access_token, /^lta_/);
  assert.match(tokens.refresh_token!, /^ltr_/);
  const rec = await verifyAccessToken(tokens.access_token, ORIGIN);
  assert.equal(rec?.home, home);
  assert.equal(rec?.clientId, client.client_id);
  // at rest: neither token appears anywhere in the store
  const all = [...objects.entries()].map(([k, v]) => k + v.text).join("\n");
  assert.equal(all.includes(tokens.access_token), false);
  assert.equal(all.includes(tokens.refresh_token!.split(".")[1]!), false);
});

test("code exchange: a wrong verifier, another client, or a different redirect URI is invalid_grant", async () => {
  const client = await publicClient();
  const other = await publicClient();
  const { code, verifier } = await authorize(client.client_id);
  const ask = (o: Record<string, string>) => oauthError(tokenRequest(form({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: client.client_id, ...o }), ORIGIN));
  assert.equal((await ask({ code_verifier: random(48) })).code, "invalid_grant");
  assert.equal((await ask({ code_verifier: verifier, client_id: other.client_id })).code, "invalid_grant");
  assert.equal((await ask({ code_verifier: verifier, redirect_uri: "https://app.example/other" })).code, "invalid_grant");
  assert.equal((await ask({ code_verifier: verifier, resource: `${OTHER}/mcp` })).code, "invalid_target");
  // still unspent after the failures: the right verifier works once
  const ok = await tokenRequest(form({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: REDIRECT, client_id: client.client_id }), ORIGIN);
  assert.ok(ok.access_token);
});

test("code exchange: a code works once; replaying it revokes the tokens it was exchanged for", async () => {
  const client = await publicClient();
  const { code, verifier } = await authorize(client.client_id);
  const body = { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: REDIRECT, client_id: client.client_id };
  const first = await tokenRequest(form(body), ORIGIN);
  assert.ok(await verifyAccessToken(first.access_token, ORIGIN));
  assert.equal((await oauthError(tokenRequest(form(body), ORIGIN))).code, "invalid_grant");
  assert.equal(await verifyAccessToken(first.access_token, ORIGIN), null, "the first access token is revoked");
  assert.equal((await oauthError(tokenRequest(form({ grant_type: "refresh_token", refresh_token: first.refresh_token!, client_id: client.client_id }), ORIGIN))).code, "invalid_grant");
});

test("code exchange: two exchanges racing on one code get one token set (If-Match on the code)", async () => {
  const client = await publicClient();
  const { code, verifier } = await authorize(client.client_id);
  const body = { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: REDIRECT, client_id: client.client_id };
  const results = await Promise.allSettled([tokenRequest(form(body), ORIGIN), tokenRequest(form(body), ORIGIN)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
});

/* ───────────── Refresh ───────────── */

test("refresh: rotates the refresh token, keeps the household, and can narrow but not widen the scope", async () => {
  const { client, tokens, home } = await signedIn();
  const next = await tokenRequest(form({ grant_type: "refresh_token", refresh_token: tokens.refresh_token!, client_id: client.client_id, scope: "mcp:tools" }), ORIGIN);
  assert.notEqual(next.refresh_token, tokens.refresh_token);
  assert.equal(next.scope, "mcp:tools");
  assert.equal((await verifyAccessToken(next.access_token, ORIGIN))?.home, home);
  assert.ok(await verifyAccessToken(tokens.access_token, ORIGIN), "the earlier access token lives until it expires");
  const wider = await oauthError(tokenRequest(form({ grant_type: "refresh_token", refresh_token: next.refresh_token!, client_id: client.client_id, scope: "mcp:tools mcp:service" }), ORIGIN));
  assert.equal(wider.code, "invalid_scope");
});

test("refresh: presenting a rotated-out refresh token revokes the whole grant", async () => {
  const { client, tokens } = await signedIn();
  const next = await tokenRequest(form({ grant_type: "refresh_token", refresh_token: tokens.refresh_token!, client_id: client.client_id }), ORIGIN);
  const replay = await oauthError(tokenRequest(form({ grant_type: "refresh_token", refresh_token: tokens.refresh_token!, client_id: client.client_id }), ORIGIN));
  assert.equal(replay.code, "invalid_grant");
  assert.equal(await verifyAccessToken(next.access_token, ORIGIN), null);
  assert.equal(await verifyAccessToken(tokens.access_token, ORIGIN), null);
  assert.equal((await oauthError(tokenRequest(form({ grant_type: "refresh_token", refresh_token: next.refresh_token!, client_id: client.client_id }), ORIGIN))).code, "invalid_grant");
});

test("refresh: another client can't use someone else's refresh token", async () => {
  const { tokens } = await signedIn();
  const other = await publicClient();
  assert.equal((await oauthError(tokenRequest(form({ grant_type: "refresh_token", refresh_token: tokens.refresh_token!, client_id: other.client_id }), ORIGIN))).code, "invalid_grant");
});

/* ───────────── Revocation ───────────── */

test("revocation: a refresh token ends the grant and its access tokens; an access token ends only itself", async () => {
  const a = await signedIn();
  await revokeRequest(form({ token: a.tokens.access_token, client_id: a.client.client_id }));
  assert.equal(await verifyAccessToken(a.tokens.access_token, ORIGIN), null);
  const fresh = await tokenRequest(form({ grant_type: "refresh_token", refresh_token: a.tokens.refresh_token!, client_id: a.client.client_id }), ORIGIN);
  assert.ok(await verifyAccessToken(fresh.access_token, ORIGIN), "revoking the access token left the grant alone");

  await revokeRequest(form({ token: fresh.refresh_token!, client_id: a.client.client_id }));
  assert.equal(await verifyAccessToken(fresh.access_token, ORIGIN), null);
  assert.equal((await oauthError(tokenRequest(form({ grant_type: "refresh_token", refresh_token: fresh.refresh_token!, client_id: a.client.client_id }), ORIGIN))).code, "invalid_grant");
});

test("revocation: another client's revoke is a quiet no-op, and unknown tokens get 200 too", async () => {
  const a = await signedIn();
  const other = await publicClient();
  await revokeRequest(form({ token: a.tokens.access_token, client_id: other.client_id }));
  await revokeRequest(form({ token: a.tokens.refresh_token!, client_id: other.client_id }));
  await revokeRequest(form({ token: "lta_not-a-token", client_id: other.client_id }));
  assert.ok(await verifyAccessToken(a.tokens.access_token, ORIGIN));
});

/* ───────────── client_credentials (Alexa+ Tier 1) ───────────── */

test("client_credentials: HTTP Basic, resource required, mcp:service only, no refresh token, no household", async () => {
  const { client, secret } = await registerClient({ client_name: "Alexa+", grant_types: ["client_credentials"], token_endpoint_auth_method: "client_secret_basic" });
  assert.ok(secret);
  const missing = await oauthError(tokenRequest(form({ grant_type: "client_credentials" }, basic(client.client_id, secret!)), ORIGIN));
  assert.equal(missing.code, "invalid_request");
  const t = await tokenRequest(form({ grant_type: "client_credentials", resource: RESOURCE, scope: "mcp:service" }, basic(client.client_id, secret!)), ORIGIN);
  assert.equal(t.scope, "mcp:service");
  assert.equal(t.refresh_token, undefined);
  assert.ok(t.expires_in <= 3600);
  const rec = await verifyAccessToken(t.access_token, ORIGIN);
  assert.equal(rec?.home, null);
  // user scopes are narrowed to the service scope; unknown ones are refused
  assert.equal((await tokenRequest(form({ grant_type: "client_credentials", resource: RESOURCE, scope: "mcp:tools" }, basic(client.client_id, secret!)), ORIGIN)).scope, "mcp:service");
  assert.equal((await oauthError(tokenRequest(form({ grant_type: "client_credentials", resource: RESOURCE, scope: "admin" }, basic(client.client_id, secret!)), ORIGIN))).code, "invalid_scope");
  assert.equal((await oauthError(tokenRequest(form({ grant_type: "client_credentials", resource: `${OTHER}/mcp` }, basic(client.client_id, secret!)), ORIGIN))).code, "invalid_target");
  // client_secret_post works too
  assert.ok((await tokenRequest(form({ grant_type: "client_credentials", resource: RESOURCE, client_id: client.client_id, client_secret: secret! }), ORIGIN)).access_token);
});

test("client_credentials: a wrong secret is invalid_client (401, Basic challenge); public clients can't use the grant", async () => {
  const { client } = await registerClient({ grant_types: ["client_credentials"], token_endpoint_auth_method: "client_secret_basic" });
  const bad = await oauthError(tokenRequest(form({ grant_type: "client_credentials", resource: RESOURCE }, basic(client.client_id, "lts_wrong")), ORIGIN));
  assert.equal(bad.code, "invalid_client");
  assert.equal(bad.status, 401);
  assert.equal(bad.basicChallenge, true);
  const pub = await publicClient();
  assert.equal((await oauthError(tokenRequest(form({ grant_type: "client_credentials", resource: RESOURCE, client_id: pub.client_id }), ORIGIN))).code, "unauthorized_client");
  await assert.rejects(registerClient({ grant_types: ["client_credentials"], token_endpoint_auth_method: "none" }), /confidential/);
});

/* ───────────── Binding ───────────── */

test("binding: a token is only good at the origin it was issued for", async () => {
  const { tokens } = await signedIn();
  assert.ok(await verifyAccessToken(tokens.access_token, ORIGIN));
  assert.equal(await verifyAccessToken(tokens.access_token, OTHER), null);
});

test("registration: http redirects only on loopback, no fragments, no javascript:", async () => {
  await assert.rejects(registerClient({ redirect_uris: ["http://app.example/cb"], token_endpoint_auth_method: "none" }), /localhost/);
  await assert.rejects(registerClient({ redirect_uris: ["https://app.example/cb#x"], token_endpoint_auth_method: "none" }), /fragment/);
  await assert.rejects(registerClient({ redirect_uris: ["javascript:alert(1)"], token_endpoint_auth_method: "none" }), /javascript/);
  const { client } = await registerClient({ redirect_uris: ["http://127.0.0.1:4000/cb", "com.example.app:/cb"], token_endpoint_auth_method: "none" });
  // a loopback redirect may come back on another port (RFC 8252 §7.3)
  const c = await checkAuthorize({ response_type: "code", client_id: client.client_id, redirect_uri: "http://127.0.0.1:51123/cb", code_challenge: sha256b64url(random(48)), code_challenge_method: "S256" }, ORIGIN);
  assert.equal(c.kind, "ok");
});

test("metadata: RFC 8414 and RFC 9728 documents agree with each other and the endpoints", () => {
  const as = serverMetadata(ORIGIN);
  assert.equal(as.issuer, ORIGIN);
  assert.deepEqual(as.code_challenge_methods_supported, ["S256"]);
  assert.ok(as.grant_types_supported.includes("client_credentials"));
  assert.equal(as.client_id_metadata_document_supported, true);
  const pr = resourceMetadata(ORIGIN, "/api/mcp/account");
  assert.equal(pr.resource, `${ORIGIN}/api/mcp/account`);
  assert.deepEqual(pr.authorization_servers, [as.issuer]);
  assert.equal(resourceMetadata(ORIGIN).resource, RESOURCE);
});

/* ───────────── Client ID metadata documents ───────────── */

test("client ID metadata documents: fetched with guards, and a usable client afterwards", async () => {
  clearMetadataCacheForTests();
  const id = "https://client.example/oauth/metadata.json";
  const doc = { client_id: id, client_name: "Doc client", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" };
  const publicIp = async () => ["93.184.215.14"];
  const serve = (body: unknown) => (async () => Response.json(body)) as unknown as typeof fetch;
  await assert.rejects(fetchMetadataDocument(id, { fetch: serve(doc), resolve: async () => ["169.254.169.254"] }), /can't fetch/);
  await assert.rejects(fetchMetadataDocument(id, { fetch: serve({ ...doc, client_id: "https://evil.example/x" }), resolve: publicIp }), /different client_id/);
  await assert.rejects(fetchMetadataDocument(id, { fetch: serve({ ...doc, token_endpoint_auth_method: "client_secret_basic" }), resolve: publicIp }), /none/);
  await assert.rejects(fetchMetadataDocument("http://client.example/m.json"), /HTTPS/);
  assert.equal((await fetchMetadataDocument(id, { fetch: serve(doc), resolve: publicIp })).client_name, "Doc client");
  // cached: the authorization endpoint now knows the client, as a public one
  const { code, verifier } = await authorize(id);
  const t = await tokenRequest(form({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: REDIRECT, client_id: id }), ORIGIN);
  assert.ok(t.refresh_token);
  for (const ip of ["10.0.0.1", "127.0.0.1", "172.16.4.4", "192.168.1.1", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) assert.equal(isPrivateAddress(ip), true, ip);
  assert.equal(isPrivateAddress("93.184.215.14"), false);
});

/* ───────────── The MCP endpoint ───────────── */

async function mcp(url: string, token?: string) {
  const client = new Client({ name: "oauth-test", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), token ? { authProvider: { token: async () => token } } : undefined));
  return client;
}

test("MCP: /api/mcp/account without a token is 401 with the resource metadata; /api/mcp stays the guest", async () => {
  const res = await route(new Request(`${ORIGIN}/api/mcp/account`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" }));
  assert.equal(res.status, 401);
  const challenge = res.headers.get("www-authenticate") ?? "";
  assert.match(challenge, /^Bearer /);
  assert.match(challenge, /resource_metadata="http:\/\/lowtide\.test\/\.well-known\/oauth-protected-resource\/api\/mcp\/account"/);
  assert.match(res.headers.get("access-control-expose-headers") ?? "", /www-authenticate/);
  const guest = await mcp(`${ORIGIN}/api/mcp`);
  assert.ok((await guest.listTools()).tools.length >= 9);
  await guest.close();
  const bad = await route(new Request(`${ORIGIN}/api/mcp`, { method: "POST", headers: { authorization: "Bearer lta_nope", "content-type": "application/json" }, body: "{}" }));
  assert.equal(bad.status, 401);
  assert.match(bad.headers.get("www-authenticate") ?? "", /error="invalid_token"/);
});

test("MCP: a household token reaches its household; a service token gets the guest tools and a 403 for the household's", async () => {
  const { tokens, home } = await signedIn();
  const c = await mcp(`${ORIGIN}/api/mcp/account`, tokens.access_token);
  const plan = (await c.callTool({ name: "plan_appliance", arguments: { appliance: "dishwasher" } })) as { content: { text: string }[] };
  const start = plan.content[1]!.text.match(/pass start "([^"]+)"/)![1]!;
  const saved = (await c.callTool({ name: "schedule_run", arguments: { appliance: "dishwasher", start } })) as { content: { text: string }[] };
  assert.match(saved.content[0]!.text, /^Saved\./);
  assert.equal((await loadHome(home))!.runs.length, 1, "the run landed in the token's household");
  await c.close();

  const { client, secret } = await registerClient({ grant_types: ["client_credentials"], token_endpoint_auth_method: "client_secret_basic" });
  const svc = await tokenRequest(form({ grant_type: "client_credentials", resource: RESOURCE }, basic(client.client_id, secret!)), ORIGIN);
  const s = await mcp(`${ORIGIN}/api/mcp/account`, svc.access_token);
  assert.ok((await s.listTools()).tools.length >= 9);
  const tide = (await s.callTool({ name: "get_tide", arguments: { place: "Germany" } })) as { isError?: boolean };
  assert.notEqual(tide.isError, true);
  await s.close();
  const forbidden = await route(
    new Request(`${ORIGIN}/api/mcp/account`, {
      method: "POST",
      headers: { authorization: `Bearer ${svc.access_token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_runs", arguments: {} } }),
    }),
  );
  assert.equal(forbidden.status, 403);
  assert.match(forbidden.headers.get("www-authenticate") ?? "", /error="insufficient_scope"/);
});

test("consent helpers: a pasted household link or bare id names the household; anything else doesn't", () => {
  assert.equal(homeIdFrom("https://d1soo7510nfzf4.cloudfront.net/api/mcp/h/abcdefgh23"), "abcdefgh23");
  assert.equal(homeIdFrom("  abcdefgh23 "), "abcdefgh23");
  assert.equal(homeIdFrom("https://x.example/api/mcp/h/abcdefgh23/../../etc"), "abcdefgh23");
  assert.equal(homeIdFrom("https://x.example/api/mcp/h/ABC"), null);
});
