/**
 * schedule_run asks for confirmation through MCP elicitation when the client can show a form, and keeps the
 * model's spoken "yes" when it can't. Drives the real MCP handler in-process with the real SDK client: the
 * network is a stubbed fetch, households go to a temp dir.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ORIGINAL_CWD = process.cwd();
const TMP = mkdtempSync(path.join(tmpdir(), "lowtide-elicit-"));
process.chdir(TMP);
for (const k of ["BLOB_READ_WRITE_TOKEN", "S3_BUCKET", "GCS_BUCKET", "BEDROCK_ACCESS_KEY_ID", "BEDROCK_SECRET_ACCESS_KEY"]) delete process.env[k];
process.on("exit", () => {
  process.chdir(ORIGINAL_CWD);
  rmSync(TMP, { recursive: true, force: true });
});

const HOUR = 3600_000;
const BASE = Math.floor(Date.now() / HOUR) * HOUR;
const realFetch = globalThis.fetch;
// aWATTar (Germany): dear now, a 2 ct trough five and six hours ahead.
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("https://api.awattar.de/")) {
    const data = [];
    for (let h = -3; h < 24; h++) data.push({ start_timestamp: BASE + h * HOUR, end_timestamp: BASE + (h + 1) * HOUR, marketprice: (h === 5 || h === 6 ? 2 : 30) * 10, unit: "Eur/MWh" });
    return Response.json({ data });
  }
  if (url.startsWith("http://lowtide.test/")) return handle(input instanceof Request ? input : new Request(url, init));
  return realFetch(input, init);
}) as typeof fetch;

const { lowtideHandler } = await import("../lib/mcp/handler");
const { createHome, loadHome } = await import("../lib/store");
const { Client, StreamableHTTPClientTransport } = await import("@modelcontextprotocol/client");

let handle: (req: Request) => Promise<Response> = async () => new Response("not ready", { status: 503 });

async function clientFor(homeId: string, answer: "accept" | "decline" | "none") {
  const h = lowtideHandler(homeId);
  handle = async (req) => {
    if (req.method === "GET") return new Response(null, { status: 405 });
    return h(req);
  };
  const asked: string[] = [];
  const client =
    answer === "none"
      ? new Client({ name: "test", version: "1" })
      : // Elicitation rides the 2026-07-28 multi-round-trip flow, so the client opts into that protocol.
        new Client({ name: "test", version: "1" }, { capabilities: { elicitation: { form: {} } }, versionNegotiation: { mode: "auto" } });
  if (answer !== "none") {
    client.setRequestHandler("elicitation/create", async (req: { params: { message: string } }) => {
      asked.push(req.params.message);
      return answer === "accept" ? { action: "accept", content: { save: true } } : { action: "decline" };
    });
  }
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://lowtide.test/api/mcp/h/${homeId}`)));
  return { client, asked };
}

async function planStart(client: InstanceType<typeof Client>) {
  const plan = (await client.callTool({ name: "plan_appliance", arguments: { appliance: "dishwasher" } })) as { content: { text: string }[] };
  return plan.content[1].text.match(/pass start "([^"]+)"/)![1];
}

const text = (r: unknown) => (r as { content: { text: string }[] }).content[0].text;

test("elicitation: a client with forms is asked, and accepting saves the run", async () => {
  const home = await createHome("Berlin", "DE");
  const { client, asked } = await clientFor(home.home.id, "accept");
  const start = await planStart(client);
  const r = await client.callTool({ name: "schedule_run", arguments: { appliance: "dishwasher", start } });
  assert.equal(asked.length, 1);
  assert.match(asked[0], /^Save the dishwasher for .+\? It costs about/);
  assert.match(text(r), /^Saved\. Run the dishwasher/);
  assert.equal((await loadHome(home.home.id))!.runs.filter((x) => x.status === "planned").length, 1);
  await client.close();
});

test("elicitation: declining the form saves nothing", async () => {
  const home = await createHome("Berlin", "DE");
  const { client, asked } = await clientFor(home.home.id, "decline");
  const start = await planStart(client);
  const r = await client.callTool({ name: "schedule_run", arguments: { appliance: "dishwasher", start } });
  assert.equal(asked.length, 1);
  assert.equal(text(r), "Okay, I won't save it.");
  assert.equal((await loadHome(home.home.id))!.runs.length, 0);
  await client.close();
});

test("elicitation: a client without forms (the Echo simulator, most chat hosts) saves on the model's yes", async () => {
  const home = await createHome("Berlin", "DE");
  const { client } = await clientFor(home.home.id, "none");
  const start = await planStart(client);
  const r = await client.callTool({ name: "schedule_run", arguments: { appliance: "dishwasher", start } });
  assert.match(text(r), /^Saved\. Run the dishwasher/);
  assert.equal((await loadHome(home.home.id))!.runs.length, 1);
  await client.close();
});

test("elicitation: a 2025-protocol client is never sent a form it can't be asked over stateless HTTP", async () => {
  const home = await createHome("Berlin", "DE");
  const h = lowtideHandler(home.home.id);
  handle = async (req) => (req.method === "GET" ? new Response(null, { status: 405 }) : h(req));
  const asked: string[] = [];
  const client = new Client({ name: "test", version: "1" }, { capabilities: { elicitation: { form: {} } } });
  client.setRequestHandler("elicitation/create", async (req: { params: { message: string } }) => {
    asked.push(req.params.message);
    return { action: "decline" };
  });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://lowtide.test/api/mcp/h/${home.home.id}`)));
  assert.equal(client.getNegotiatedProtocolVersion(), "2025-11-25");
  const start = await planStart(client);
  const r = await client.callTool({ name: "schedule_run", arguments: { appliance: "dishwasher", start } });
  assert.equal(asked.length, 0);
  assert.match(text(r), /^Saved\. Run the dishwasher/);
  await client.close();
});
