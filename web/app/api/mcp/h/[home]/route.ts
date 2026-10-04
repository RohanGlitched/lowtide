import { lowtideHandler, preflight, withCors } from "@/lib/mcp/handler";
import { HOME_ID } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 30;

async function handle(req: Request, { params }: { params: Promise<{ home: string }> }) {
  const { home } = await params;
  if (!HOME_ID.test(home)) {
    return withCors(Response.json({ error: "This isn't a Lowtide household link." }, { status: 404 }));
  }
  return lowtideHandler(home)(req);
}
export { handle as GET, handle as POST, handle as DELETE, preflight as OPTIONS };
