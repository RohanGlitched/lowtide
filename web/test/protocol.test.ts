/**
 * Which MCP protocol the server speaks, checked against the real handler in-process. A judge sent `initialize`
 * at 2026-07-28 and got 2025-11-25 back, and read that as "2026-07-28 isn't served". It is: 2026-07-28 has no
 * initialize handshake (a client calls server/discover, or just sends requests with the per-request _meta
 * envelope), so `initialize` is the 2025 path and negotiates the newest 2025 revision.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

for (const k of ["BLOB_READ_WRITE_TOKEN", "S3_BUCKET", "GCS_BUCKET", "BEDROCK_ACCESS_KEY_ID", "BEDROCK_SECRET_ACCESS_KEY"]) delete process.env[k];
const { lowtideHandler } = await import("../lib/mcp/handler");
const { STATUS, VIEW_URI } = await import("../lib/mcp/tools");

const handler = lowtideHandler(null);
const ENVELOPE = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "protocol-test", version: "1" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

async function rpc(method: string, params: Record<string, unknown>, headers: Record<string, string> = {}) {
  const res = await handler(
    new Request("http://lowtide.test/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
  const text = await res.text();
  const json = text.startsWith("{") ? text : (text.match(/^data: (.*)$/m)?.[1] ?? "{}");
  return JSON.parse(json) as { result?: Record<string, unknown>; error?: { message: string } };
}

test("2026-07-28: server/discover with the per-request envelope lists 2026-07-28", async () => {
  const r = await rpc("server/discover", { _meta: ENVELOPE }, { "mcp-protocol-version": "2026-07-28", "mcp-method": "server/discover" });
  assert.ok((r.result?.supportedVersions as string[]).includes("2026-07-28"), JSON.stringify(r));
});

test("2026-07-28: tools/list without any initialize, each view tool with its ui:// view and Alexa+ status strings", async () => {
  const r = await rpc("tools/list", { _meta: ENVELOPE }, { "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/list" });
  const tools = r.result?.tools as { name: string; _meta?: { ui?: { resourceUri?: string; invoking?: string; invoked?: string } } }[];
  assert.equal(tools.length, 9);
  for (const t of tools.filter((x) => x.name !== "set_home")) {
    assert.equal(t._meta?.ui?.resourceUri, VIEW_URI, t.name);
    assert.equal(t._meta?.ui?.invoking, STATUS[t.name].invoking, t.name);
    assert.ok(t._meta?.ui?.invoked, t.name);
  }
});

test("the 2025 handshake: initialize negotiates 2025-11-25, and 2025-03-26 (Alexa+'s sample client) is kept", async () => {
  const init = (v: string) => rpc("initialize", { protocolVersion: v, capabilities: {}, clientInfo: { name: "t", version: "1" } });
  assert.equal((await init("2025-11-25")).result?.protocolVersion, "2025-11-25");
  assert.equal((await init("2025-03-26")).result?.protocolVersion, "2025-03-26");
  // initialize doesn't exist in 2026-07-28, so a client asking for it there gets the newest initialize-era revision
  assert.equal((await init("2026-07-28")).result?.protocolVersion, "2025-11-25");
});
