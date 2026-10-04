import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
const base = process.argv[2];
const demo = process.argv[3] === "demo";
const home = await fetch(`${base}/api/homes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ place: "SE1 7PB", demo }) }).then((r) => r.json());
console.log(home.id, "demo", home.demo);
const c = new Client({ name: "r", version: "1" });
await c.connect(new StreamableHTTPClientTransport(new URL(home.mcpUrl)));
const p = await c.callTool({ name: "plan_appliance", arguments: { appliance: "dishwasher", finish_by: "07:00" } });
const start = p.content[1].text.match(/start "([^"]+)"/)[1];
for (let i = 0; i < 2; i++) {
  const r = await c.callTool({ name: "schedule_run", arguments: { appliance: i ? "washing machine" : "dishwasher", start } });
  console.log("schedule", i, r.isError ? "ERROR" : "ok", r.content[0].text.slice(0, 90));
}
