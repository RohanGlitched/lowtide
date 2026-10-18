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
  if (opts.earliest && opts.finishBy && opts.earliest + dur > opts.finishBy) {
    throw new Error("That window closes before the run could finish. Give me a later deadline or an earlier start.");
  }
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
  // A window with a gap in the carbon forecast can't compete on carbon, but the others still can.
  const withCarbon = runs.filter((r) => r.carbon !== null);
  const byCarbon = [...withCarbon].sort((a, b) => a.carbon! - b.carbon! || a.start - b.start);
  const cheapest = byCost[0];
  const greenest = byCarbon[0] ?? null;

  let best = cheapest;
  if (goal === "greenest" && greenest) best = greenest;
  if (goal === "balanced" && greenest) {
    // Normalised distance from each optimum; ties go to the earlier start.
    const span = (xs: number[]) => Math.max(1e-9, Math.max(...xs) - Math.min(...xs));
    const cSpan = span(withCarbon.map((r) => r.cost));
    const gSpan = span(withCarbon.map((r) => r.carbon!));
    best = [...withCarbon].sort(
      (a, b) =>
        (a.cost - cheapest.cost) / cSpan + (a.carbon! - greenest.carbon!) / gSpan -
          ((b.cost - cheapest.cost) / cSpan + (b.carbon! - greenest.carbon!) / gSpan) || a.start - b.start,
    )[0];
  }

  const nowRun = earliest - now < 60_000 ? costRun(slots, now, opts.minutes, opts.kwh) : null;
  // Asked for the cheapest time, never send someone to wait for a start that saves less than a penny (or cent)
  // on starting now: then now wins. Greener goals may cost more than now; planResult says so out loud.
  if (nowRun && (goal === "cheapest" || !greenest) && nowRun.cost - best.cost < 1) best = nowRun;
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

/**
 * What a run costs at a typical time: the average over every half-hour start from `from` that finishes within
 * `hours` and is fully priced. This is the baseline Lowtide quotes savings against on the website (running the
 * load whenever was convenient), rather than the evening peak, which would flatter every saving.
 */
export function typicalCost(slots: Slot[], minutes: number, kwh: number, from: number, hours = 24): number | null {
  const horizon = from + hours * 3600_000;
  let sum = 0;
  let n = 0;
  for (let t = Math.ceil(from / STEP) * STEP; t + minutes * 60_000 <= horizon; t += STEP) {
    const r = costRun(slots, t, minutes, kwh);
    if (!r) continue;
    sum += r.cost;
    n++;
  }
  return n ? round(sum / n) : null;
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

export type Mark = Run & { isNow: boolean };

/**
 * The cheapest and dearest half hour still to come in the next `hours`, the half hour under way included (as
 * `isNow`). Everything a person sees next to "now" uses this, so "cheapest" is on the same basis as the current
 * half-hour price and can never read dearer than it: when this half hour is the cheapest, the answer is "now".
 * (A rolling hourly mean that starts in the current slot used to show "cheapest 13:30, 26.8p" beside "now 25.6p".)
 */
export function cheapAndDear(slots: Slot[], now: number, hours = 24): { low: Mark | null; high: Mark | null } {
  const end = now + hours * 3600_000;
  const live = slots.filter((s) => s.end > now && s.start < end);
  if (!live.length) return { low: null, high: null };
  const marks: Mark[] = live.map((s) => ({ start: s.start, end: s.end, cost: s.price, carbon: s.carbon, avgPrice: s.price, isNow: s.start <= now && now < s.end }));
  const sorted = [...marks].sort((a, b) => a.avgPrice - b.avgPrice || a.start - b.start);
  // A tie with the current half hour is "now": never send someone to wait for the same price.
  const lowest = sorted[0];
  const cur = marks.find((m) => m.isNow);
  const low = cur && cur.avgPrice <= lowest.avgPrice ? cur : lowest;
  return { low, high: sorted[sorted.length - 1] };
}

const round = (n: number) => Math.round(n * 100) / 100;
