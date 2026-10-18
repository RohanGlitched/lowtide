import { preflight } from "@/lib/mcp/handler";
import { protectedMcp } from "@/lib/oauth/resource";
import { ACCOUNT_PATH } from "@/lib/oauth/config";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * The same MCP server as /api/mcp, behind OAuth from the first request: without a token it answers 401 with
 * the protected resource metadata, so Claude, ChatGPT and any MCP SDK client discover Lowtide's authorization
 * server, register, and send the person to the consent page to pick a household.
 */
const handle = (req: Request) => protectedMcp(req, { path: ACCOUNT_PATH, required: true });
export { handle as GET, handle as POST, handle as DELETE, preflight as OPTIONS };
