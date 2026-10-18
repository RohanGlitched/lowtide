/** The home page's "Choose what to move" panel, as a pure function so it can be tested. */
export type PickerSlot = { s: number; e: number; p: number };

/** Cost of running `kwh` evenly over [start, start + minutes), or null where prices aren't published. */
export function pickerCost(slots: PickerSlot[], start: number, minutes: number, kwh: number): number | null {
  const end = start + minutes * 60_000;
  let c = 0;
  let covered = 0;
  for (const x of slots) {
    const a = Math.max(start, x.s);
    const b = Math.min(end, x.e);
    if (b > a) {
      c += ((kwh * (b - a)) / (end - start)) * x.p;
      covered += b - a;
    }
  }
  return covered >= end - start - 1000 ? c : null;
}

export interface PickerPlan {
  best: { start: number; c: number } | null;
  worst: { start: number; c: number } | null;
  nowC: number | null;
  startsNow: boolean;
  /** the average over every start time in the next 24 hours: savings are quoted against this, not the peak */
  typical: number | null;
}

/**
 * The cheapest start for a load over the next 24 hours. Starting now is a candidate too, and it wins unless
 * waiting saves at least a penny (or cent): the same rule as the planner (lib/plan.ts), so the panel never tells
 * you to wait hours to pay the same or more.
 */
export function pickPlan(slots: PickerSlot[], now: number, load: { kwh: number; minutes: number }): PickerPlan {
  const horizon = now + 24 * 3600_000;
  let best: { start: number; c: number } | null = null;
  let worst: { start: number; c: number } | null = null;
  let sum = 0;
  let n = 0;
  for (let t = Math.ceil(now / 1800_000) * 1800_000; t + load.minutes * 60_000 <= horizon; t += 1800_000) {
    const c = pickerCost(slots, t, load.minutes, load.kwh);
    if (c == null) continue;
    sum += c;
    n++;
    if (!best || c < best.c) best = { start: t, c };
    if (!worst || c > worst.c) worst = { start: t, c };
  }
  const nowC = pickerCost(slots, now, load.minutes, load.kwh);
  if (nowC != null && (!best || best.c > nowC - 1)) best = { start: now, c: nowC };
  return { best, worst, nowC, startsNow: best != null && best.start === now, typical: n ? sum / n : null };
}
