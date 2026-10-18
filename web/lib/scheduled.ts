import { timingSafeEqual } from "node:crypto";
import { rollTonight } from "./tonight";
import { log } from "./log";

/**
 * The scheduled side of tonight's plan. Amazon EventBridge Scheduler invokes the Lambda function twice each
 * evening (16:45 and 18:30 London time, after Octopus publishes tomorrow's Agile prices); the Lambda Web Adapter
 * hands that non-HTTP event to this app as a POST to /events. The job walks every saved household
 * with the same idempotent roll ordinary requests take a step of (the lazy fallback), until it is done or the
 * time budget runs out, and logs one JSON summary line for CloudWatch.
 */
export const SCHEDULE_EVENT = { source: "lowtide.schedule", job: "tonight" } as const;

/**
 * Whether a parsed /events body really came from our schedule. Next.js adds forwarding headers to every request
 * it serves, the adapter's loopback call included, so headers can't tell the schedule from a visitor. Instead each
 * deploy generates a random token that only two places hold: the function's environment (SCHEDULE_TOKEN) and the
 * schedule's event Input. CloudFront doesn't route /events at all; this guards the Function URL. Returns the
 * reason when the token is missing or wrong.
 */
export function scheduledGuard(body: unknown, expected: string = process.env.SCHEDULE_TOKEN ?? ""): string | null {
  if (expected.length < 16) return "no schedule token configured";
  const got = (body as Record<string, unknown> | null)?.token;
  if (typeof got !== "string") return "no token";
  const x = Buffer.from(got);
  const y = Buffer.from(expected);
  if (x.length !== y.length || !timingSafeEqual(x, y)) return "wrong token";
  return null;
}

/** The five-minute keep-warm event (KeepWarmSchedule in infra/template.yaml). */
export const WARM_EVENT = { source: "lowtide.schedule", job: "warm" } as const;

/** Whether a parsed body is the schedule's event (the Input in infra/template.yaml). */
export function isScheduleEvent(body: unknown): boolean {
  const b = body as Record<string, unknown> | null;
  return Boolean(b && typeof b === "object" && b.source === SCHEDULE_EVENT.source && b.job === SCHEDULE_EVENT.job);
}

/** Whether a parsed body is the keep-warm event. */
export function isWarmEvent(body: unknown): boolean {
  const b = body as Record<string, unknown> | null;
  return Boolean(b && typeof b === "object" && b.source === WARM_EVENT.source && b.job === WARM_EVENT.job);
}

/**
 * Keep-warm: the schedule wakes one instance every five minutes, and this refreshes what the first visitor would
 * otherwise wait for (the home page's places, every British region for /tables, and the demo household's two
 * weeks of history). Each fetch is cached in the instance, so the next page render or Echo set-up is warm.
 */
export async function runWarm(
  warmers: (() => Promise<unknown>)[],
  budgetMs = 12_000,
): Promise<{ warmed: number; failed: number; ms: number }> {
  const t0 = Date.now();
  const timeout = new Promise<"late">((r) => setTimeout(() => r("late"), budgetMs));
  const settled = await Promise.all(
    warmers.map((w) =>
      Promise.race([
        w().then(
          () => true,
          () => false,
        ),
        timeout.then(() => false),
      ]),
    ),
  );
  const out = { warmed: settled.filter(Boolean).length, failed: settled.filter((x) => !x).length, ms: Date.now() - t0 };
  log({ evt: "warm", ...out });
  return out;
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
