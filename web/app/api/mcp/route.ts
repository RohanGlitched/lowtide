import { lowtideHandler, preflight } from "@/lib/mcp/handler";

export const runtime = "nodejs";
export const maxDuration = 30;

const handler = lowtideHandler(null);

/** A person who opens the endpoint in a browser gets a page that says what it is; MCP clients get the protocol. */
async function get(req: Request) {
  if ((req.headers.get("accept") ?? "").includes("text/html")) {
    const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Lowtide MCP server</title>
<style>body{font:17px/1.55 system-ui,sans-serif;max-width:40em;margin:12vh auto;padding:0 20px;color:#16181b;background:#f6f7f9}code{background:#e9ebee;padding:2px 6px;border-radius:4px}a{color:#2340ff}</style>
<h1>This is Lowtide's MCP server</h1>
<p>It speaks the Model Context Protocol over Streamable HTTP, so there is nothing to see here in a browser. Add this address to an assistant that supports remote MCP servers, such as Claude, ChatGPT or VS Code:</p>
<p><code>${new URL(req.url).origin}/api/mcp</code></p>
<p>Then ask: "When is electricity cheapest tonight in SE1 7PB?" For saved runs and savings, <a href="/connect">make a household link</a>. To try it on a simulated Echo Show, <a href="/echo">open the Echo</a>, or test it in <a href="https://countertop-mcp.vercel.app/?server=${new URL(req.url).origin}/api/mcp">Countertop</a>.</p>
<p><a href="/">Lowtide home</a> · <a href="https://github.com/RohanGlitched/lowtide">Source</a></p>`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  return handler(req);
}
export { get as GET, handler as POST, handler as DELETE, preflight as OPTIONS };
