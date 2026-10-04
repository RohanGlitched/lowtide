import { lowtideHandler, preflight } from "@/lib/mcp/handler";

export const runtime = "nodejs";
export const maxDuration = 30;

const handler = lowtideHandler(null);
export { handler as GET, handler as POST, handler as DELETE, preflight as OPTIONS };
