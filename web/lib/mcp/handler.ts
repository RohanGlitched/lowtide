import "server-only";
import { createMcpHandler } from "mcp-handler";
import { registerLowtide, SERVER_INSTRUCTIONS } from "./tools";

const SERVER_INFO = { name: "Lowtide", version: "1.0.0" };

/** One MCP endpoint per household (`homeId`), plus a guest endpoint (`null`) for read-only questions. */
export function lowtideHandler(homeId: string | null) {
  return createMcpHandler((server) => registerLowtide(server, { homeId }), {
    serverInfo: SERVER_INFO,
    instructions: SERVER_INSTRUCTIONS,
  });
}
