// schedule_run's elicitation confirm against a deployment, with a client that speaks 2026-07-28 and shows forms.
// Usage: node scripts/elicit-smoke.mjs https://d1soo7510nfzf4.cloudfront.net [accept|decline]
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const [base, answer = "decline"] = process.argv.slice(2);
const home = await fetch(`${base}/api/homes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ place: "SE1 7PB" }) }).then((r) => r.json());
const quiet = (input, init) => ((init?.method ?? "GET").toUpperCase() === "GET" ? Promise.resolve(new Response(null, { status: 405 })) : fetch(input, init));
const client = new Client({ name: "elicit-smoke", version: "1" }, { capabilities: { elicitation: { form: {} } }, versionNegotiation: { mode: "auto" } });
client.setRequestHandler("elicitation/create", async (req) => {
  console.log("form:", req.params.message, JSON.stringify(req.params.requestedSchema));
  return answer === "accept" ? { action: "accept", content: { save: true } } : { action: "decline" };
});
await client.connect(new StreamableHTTPClientTransport(new URL(home.mcpUrl), { fetch: quiet }));
console.log("protocol:", client.getNegotiatedProtocolVersion());
const plan = await client.callTool({ name: "plan_appliance", arguments: { appliance: "dishwasher" } });
const start = plan.content[1].text.match(/pass start "([^"]+)"/)[1];
const t0 = Date.now();
const r = await client.callTool({ name: "schedule_run", arguments: { appliance: "dishwasher", start } });
console.log(`schedule_run (${answer}, ${Date.now() - t0} ms):`, r.content[0].text);
const runs = await client.callTool({ name: "list_runs", arguments: {} });
console.log("list_runs:", runs.content[0].text);
await client.close();
