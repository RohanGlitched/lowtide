// Calls every Lowtide tool over Streamable HTTP. Usage: node scripts/mcp-smoke.mjs [baseUrl] [place]
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const base = process.argv[2] || "http://localhost:3000";
const place = process.argv[3] || "SW1A 2AA";
const home = await fetch(`${base}/api/homes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ place }) }).then((r) => r.json());
console.log("home:", home);
const client = new Client({ name: "lowtide-smoke", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(home.mcpUrl)));
const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => `${t.name}${t._meta?.ui ? " [ui]" : ""}`).join(", "));
const res = await client.listResources();
console.log("resources:", res.resources.map((r) => r.uri).join(", "));
const calls = [
  ["get_tide", {}],
  ["check_now", {}],
  ["plan_appliance", { appliance: "dishwasher", finish_by: "07:00" }],
  ["plan_appliance", { appliance: "car", kwh: 20, goal: "balanced" }],
  ["schedule_run", { appliance: "dishwasher", start: "" }],
  ["list_runs", {}],
  ["get_savings", {}],
  ["cancel_run", { appliance: "washing machine" }],
];
let planStart = null;
for (const [name, args] of calls) {
  if (name === "schedule_run") args.start = planStart;
  const r = await client.callTool({ name, arguments: args });
  const text = r.content.map((c) => c.text).join(" | ");
  if (name === "plan_appliance" && !planStart) planStart = text.match(/start "([^"]+)"/)?.[1];
  console.log(`\n${name}${r.isError ? " ERROR" : ""}: ${text}`);
  if (r.structuredContent) console.log(`  view: ${r.structuredContent.kind} · ${r.structuredContent.headline} · ${r.structuredContent.sub} · ${r.structuredContent.slots.length} slots · berths ${r.structuredContent.berths.length}`);
}
await client.close();
