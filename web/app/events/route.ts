import { isScheduleEvent, runScheduledTonight, scheduledGuard } from "@/lib/scheduled";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const refuse = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

/**
 * POST /events: the Lambda Web Adapter's pass-through for non-HTTP invocations (AWS_LWA_PASS_THROUGH_PATH).
 * Amazon EventBridge Scheduler's nightly event lands here and runs tonight's plan for every saved household.
 * Only the adapter's own loopback call is accepted: anything that came through CloudFront or the Function URL
 * (which add forwarding headers) is refused, and CloudFront doesn't route /events at all.
 */
export async function POST(req: Request) {
  const why = scheduledGuard(req.headers);
  if (why) return refuse(403, "Not available.");
  let body: unknown;
  try {
    const raw = await req.text();
    if (raw.length > 64_000) return refuse(413, "Too large.");
    body = JSON.parse(raw);
  } catch {
    return refuse(400, "Bad event.");
  }
  if (!isScheduleEvent(body)) return refuse(400, "Unknown event.");
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
