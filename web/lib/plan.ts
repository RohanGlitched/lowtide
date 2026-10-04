import type { Slot } from "./grid/types";

export type Goal = "cheapest" | "greenest" | "balanced";

export interface Run {
  start: number;
  end: number;
  cost: number; // minor units (p, ¢, ct) for the whole run
  carbon: number | null; // grams CO2 for the whole run
  avgPrice: number; // minor units per kWh
}

export interface Plan {
  best: Run;
  now: Run | null; // starting right away, when the published prices cover it
  cheapest: Run;
  greenest: Run | null;
  priciest: Run;
  goal: Goal;
  kwh: number;
  minutes: number;
  horizonEnd: number; // last published price
}

const STEP = 30 * 60_000;

/**
 * Price (and carbon) of running `kwh` evenly over [start, start+minutes), or null when the published
 * slots don't cover that stretch.
 */
export function costRun(slots: Slot[], start: number, minutes: number, kwh: number): Run | null {
  const end = start + minutes * 60_000;
  const perMs = kwh / (end - start);
  let cost = 0;
  let carbon: number | null = 0;
  let covered = 0;
  for (const s of slots) {
    const a = Math.max(start, s.start);
    const b = Math.min(end, s.end);
    if (b <= a) continue;
    const e = perMs * (b - a);
    cost += e * s.price;
    carbon = carbon === null || s.carbon === null ? null : carbon + e * s.carbon;
    covered += b - a;
  }
  if (covered < end - start - 1000) return null; // a gap in the published prices
  return { start, end, cost: round(cost), carbon: carbon === null ? null : Math.round(carbon), avgPrice: round(cost / kwh) };
}

/**
 * Every feasible start between `earliest` and the deadline (on half-hour boundaries, plus right now),
 * scored for the goal. Throws a sentence a person can act on when nothing fits.
 */
export function planRun(
  slots: Slot[],
  opts: { kwh: number; minutes: number; goal?: Goal; earliest?: number; finishBy?: number; now?: number },
): Plan {
  if (!slots.length) throw new Error("No prices are published for the next few hours yet.");
  const now = opts.now ?? Date.now();
  const goal = opts.goal ?? "cheapest";
  const horizonEnd = slots[slots.length - 1].end;
  const earliest = Math.max(opts.earliest ?? now, slots[0].start, now);
  const latestEnd = Math.min(opts.finishBy ?? horizonEnd, horizonEnd);
  const dur = opts.minutes * 60_000;
  if (earliest + dur > latestEnd) {
    if (opts.finishBy && opts.finishBy < earliest + dur) {
      throw new Error("There isn't enough time to finish by then, even starting now.");
    }
    throw new Error("Prices aren't published far enough ahead to fit that run yet. Ask again after 4 p.m.");
  }

  const starts = new Set<number>([earliest]);
  for (let t = Math.ceil(earliest / STEP) * STEP; t + dur <= latestEnd; t += STEP) starts.add(t);
  const runs = [...starts]
    .filter((t) => t + dur <= latestEnd)
    .map((t) => costRun(slots, t, opts.minutes, opts.kwh))
    .filter((r): r is Run => r !== null);
  if (!runs.length) throw new Error("The published prices have a gap, so I can't price that run yet.");

  const byCost = [...runs].sort((a, b) => a.cost - b.cost || a.start - b.start);
  const withCarbon = runs.filter((r) => r.carbon !== null);
  const byCarbon = withCarbon.length === runs.length ? [...runs].sort((a, b) => a.carbon! - b.carbon! || a.start - b.start) : [];
  const cheapest = byCost[0];
  const greenest = byCarbon[0] ?? null;

  let best = cheapest;
  if (goal === "greenest" && greenest) best = greenest;
  if (goal === "balanced" && greenest) {
    // Normalised distance from each optimum; ties go to the earlier start.
    const span = (xs: number[]) => Math.max(1e-9, Math.max(...xs) - Math.min(...xs));
    const cSpan = span(runs.map((r) => r.cost));
    const gSpan = span(runs.map((r) => r.carbon!));
    best = [...runs].sort(
      (a, b) =>
        (a.cost - cheapest.cost) / cSpan + (a.carbon! - greenest.carbon!) / gSpan -
          ((b.cost - cheapest.cost) / cSpan + (b.carbon! - greenest.carbon!) / gSpan) || a.start - b.start,
    )[0];
  }

  const nowRun = earliest - now < 60_000 ? costRun(slots, now, opts.minutes, opts.kwh) : null;
  return {
    best,
    now: nowRun,
    cheapest,
    greenest,
    priciest: byCost[byCost.length - 1],
    goal,
    kwh: opts.kwh,
    minutes: opts.minutes,
    horizonEnd,
  };
}

/** Low and high water: the cheapest and dearest stretches of at least `minutes`, for the tide table. */
export function tideMarks(slots: Slot[], minutes = 60): { low: Run | null; high: Run | null } {
  if (!slots.length) return { low: null, high: null };
  const runs = slots
    .map((s) => costRun(slots, s.start, minutes, 1))
    .filter((r): r is Run => r !== null);
  if (!runs.length) return { low: null, high: null };
  const sorted = [...runs].sort((a, b) => a.cost - b.cost || a.start - b.start);
  return { low: sorted[0], high: sorted[sorted.length - 1] };
}

const round = (n: number) => Math.round(n * 100) / 100;
