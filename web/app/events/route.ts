import { isScheduleEvent, isWarmEvent, runScheduledTonight, runWarm, scheduledGuard } from "@/lib/scheduled";
import { getTide } from "@/lib/grid";
import { SCENE_PLACES, tableData } from "@/lib/live";
import { seedHistory } from "@/lib/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const refuse = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

/**
 * POST /events: the Lambda Web Adapter's pass-through for non-HTTP invocations (AWS_LWA_PASS_THROUGH_PATH).
 * Amazon EventBridge Scheduler's nightly event lands here and runs tonight's plan for every saved household.
 * Only an event carrying this deploy's schedule token is accepted (see scheduledGuard); CloudFront doesn't route
 * /events at all.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    const raw = await req.text();
    if (raw.length > 64_000) return refuse(413, "Too large.");
    body = JSON.parse(raw);
  } catch {
    return refuse(400, "Bad event.");
  }
  const warm = isWarmEvent(body);
  if (!warm && !isScheduleEvent(body)) return refuse(400, "Unknown event.");
  if (scheduledGuard(body)) return refuse(403, "Not available.");
  if (warm) {
    const summary = await runWarm([...SCENE_PLACES.map((p) => () => getTide(p.place)), () => tableData(), () => seedHistory("SE1 7PB")]);
    return Response.json({ ok: true, ...summary }, { headers: { "cache-control": "no-store" } });
  }
  try {
    const summary = await runScheduledTonight();
    return Response.json({ ok: true, ...summary }, { headers: { "cache-control": "no-store" } });
  } catch {
    return refuse(500, "The scheduled run failed; the lazy roll will catch up on the next request.");
  }
}

export function GET() {
  return refuse(405, "Not available.");
}
