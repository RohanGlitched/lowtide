import { rollTonight } from "./tonight";
import { log } from "./log";

/**
 * The scheduled side of tonight's plan. Amazon EventBridge Scheduler invokes the Lambda function twice each
 * evening (16:45 and 18:30 London time, after Octopus publishes tomorrow's Agile prices); the Lambda Web Adapter
 * hands that non-HTTP event to this app as a POST to /events from 127.0.0.1. The job walks every saved household
 * with the same idempotent roll ordinary requests take a step of (the lazy fallback), until it is done or the
 * time budget runs out, and logs one JSON summary line for CloudWatch.
 */
export const SCHEDULE_EVENT = { source: "lowtide.schedule", job: "tonight" } as const;

// Headers a request picks up on the way in from outside: CloudFront, the Function URL front end, any proxy.
const OUTSIDE = ["x-forwarded-host", "x-forwarded-for", "x-forwarded-proto", "forwarded", "via", "x-amz-cf-id", "cloudfront-viewer-address", "cloudfront-forwarded-proto"];
const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

/**
 * Whether a request is the adapter's local pass-through call, and nothing a visitor could send: addressed to
 * the loopback host, with none of the forwarding headers CloudFront or a Function URL add. Returns the reason
 * when it isn't.
 */
export function scheduledGuard(headers: Headers): string | null {
  const host = headers.get("host") ?? "";
  if (!LOCAL_HOST.test(host)) return "not the local pass-through";
  for (const h of OUTSIDE) if (headers.has(h)) return `arrived through ${h}`;
  return null;
}

/** Whether a parsed body is the schedule's event (the Input in infra/template.yaml). */
export function isScheduleEvent(body: unknown): boolean {
  const b = body as Record<string, unknown> | null;
  return Boolean(b && typeof b === "object" && b.source === SCHEDULE_EVENT.source && b.job === SCHEDULE_EVENT.job);
}

export interface ScheduledSummary {
  night: string | null; // null: tomorrow's prices aren't out yet (the 18:30 run tries again)
  planned: number;
  skipped: number;
  steps: number;
  done: boolean;
  ms: number;
}

/**
 * Runs the nightly roll to the end, a page of households at a time, inside `budgetMs` (the function times out
 * at 30 s). Every step is idempotent and its cursor is guarded with If-Match, so a retry, a second schedule or a
 * visitor's lazy step at the same moment never plans a household twice.
 */
export async function runScheduledTonight(
  deps: Pick<NonNullable<Parameters<typeof rollTonight>[0]>, "now" | "getTide"> & { budgetMs?: number; pageSize?: number; maxSteps?: number } = {},
): Promise<ScheduledSummary> {
  const t0 = Date.now();
  const budget = deps.budgetMs ?? 24_000;
  const out: ScheduledSummary = { night: null, planned: 0, skipped: 0, steps: 0, done: false, ms: 0 };
  try {
    while (out.steps < (deps.maxSteps ?? 200)) {
      const left = budget - (Date.now() - t0);
      if (left <= 500) break;
      const step = await rollTonight({ now: deps.now, getTide: deps.getTide, limit: deps.pageSize ?? 50, budgetMs: Math.min(left - 250, 8000) });
      out.steps++;
      out.night = step.night;
      out.planned += step.computed;
      out.skipped += step.skipped;
      if (step.night === null || step.done) {
        out.done = step.done;
        break;
      }
    }
    out.ms = Date.now() - t0;
    log({ evt: "schedule", job: "tonight", ok: true, night: out.night, planned: out.planned, skipped: out.skipped, steps: out.steps, done: out.done, ms: out.ms });
    return out;
  } catch (e) {
    out.ms = Date.now() - t0;
    log({ evt: "schedule", job: "tonight", ok: false, ms: out.ms, error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}
