// One full conversation through /api/alexa with the real MCP tools. Usage: node scripts/alexa-turn.mjs base "utterance" ["follow-up"]
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
const [base, ...said] = process.argv.slice(2);
const home = await fetch(`${base}/api/homes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ place: "SE1 7PB" }) }).then((r) => r.json());
const c = new Client({ name: "turn", version: "1" });
await c.connect(new StreamableHTTPClientTransport(new URL(home.mcpUrl)));
const { tools } = await c.listTools();
const specs = tools.map((t) => { const { $schema, ...schema } = t.inputSchema; return { name: t.name, description: t.description, inputSchema: schema }; });
let messages = [];
for (const u of said) {
  messages.push({ role: "user", content: [{ text: u }] });
  for (let step = 0; step < 5; step++) {
    const t0 = Date.now();
    const r = await fetch(`${base}/api/alexa`, { method: "POST", headers: { "content-type": "application/json", origin: new URL(base).origin }, body: JSON.stringify({ messages, tools: specs, timeZone: "Europe/London", place: "SE1 7PB" }) }).then((x) => x.json());
    messages.push(r.message);
    console.log(`[${r.engine} ${Date.now() - t0}ms]${r.note ? " NOTE " + r.note : ""}`);
    if (r.stop !== "tool_use") { console.log("you:", u, "\nalexa:", r.message.content.map((b) => b.text).join(" ")); break; }
    const results = [];
    for (const b of r.message.content) {
      if (!b.toolUse) continue;
      console.log("  tool:", b.toolUse.name, JSON.stringify(b.toolUse.input));
      const res = await c.callTool({ name: b.toolUse.name, arguments: b.toolUse.input });
      results.push({ toolResult: { toolUseId: b.toolUse.toolUseId, content: res.content.filter((x) => x.type === "text").map((x) => ({ text: x.text })), status: res.isError ? "error" : "success" } });
    }
    messages.push({ role: "user", content: results });
  }
}
await c.close();
