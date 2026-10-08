import { createMcpHandler } from "mcp-handler";
import { registerLowtide, SERVER_INSTRUCTIONS } from "./tools";

const SERVER_INFO = { name: "Lowtide", version: "1.0.0" };

/** Browser hosts on other origins (MCP inspectors, test benches) may call the server directly. */
export const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, accept, authorization, mcp-session-id, mcp-protocol-version, last-event-id",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
  "access-control-max-age": "86400",
};

export function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export const preflight = () => new Response(null, { status: 204, headers: CORS });

/** One MCP endpoint per household (`homeId`), plus a guest endpoint (`null`) for read-only questions. */
export function lowtideHandler(homeId: string | null) {
  const handler = createMcpHandler((server) => registerLowtide(server, { homeId }), {
    serverInfo: SERVER_INFO,
    instructions: SERVER_INSTRUCTIONS,
  });
  return async (req: Request) => withCors(await handler(req));
}
