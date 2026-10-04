import { test } from "node:test";
import assert from "node:assert/strict";
import { costRun, planRun, tideMarks } from "../lib/plan";
import type { Slot } from "../lib/grid/types";

const H = 30 * 60_000;
const T0 = Date.UTC(2026, 9, 4, 16, 0); // 17:00 London (BST)

/** Half-hour slots from T0 with the given prices (and optional carbon). */
function slots(prices: number[], carbon?: number[]): Slot[] {
  return prices.map((p, i) => ({ start: T0 + i * H, end: T0 + (i + 1) * H, price: p, carbon: carbon ? carbon[i] : null }));
}

test("costRun spreads energy evenly across the slots it covers", () => {
  const s = slots([10, 20, 30, 40]);
  const r = costRun(s, T0, 60, 2)!; // 1 kWh in each of the first two slots
  assert.equal(r.cost, 30);
  assert.equal(r.avgPrice, 15);
  const partial = costRun(s, T0 + H / 2, 60, 2)!; // half, full, half
  assert.equal(partial.cost, 0.5 * 10 + 1 * 20 + 0.5 * 30);
});

test("costRun refuses a stretch the published prices don't cover", () => {
  assert.equal(costRun(slots([10, 20]), T0 + H, 60, 1), null);
});

test("planRun finds the cheapest window and compares it with starting now", () => {
  const s = slots([40, 38, 30, 12, 8, 9, 25, 41]);
  const p = planRun(s, { kwh: 1, minutes: 60, now: T0 });
  // Slots 4 and 5 (8p, 9p) are the cheapest hour: 8.5p for 1 kWh.
  assert.equal(p.best.start, T0 + 4 * H);
  assert.equal(p.cheapest.cost, 8.5);
  assert.equal(p.now!.cost, 39);
  assert.equal(p.priciest.cost, 39);
});

test("planRun respects a finish-by deadline", () => {
  const s = slots([30, 10, 10, 30, 1, 1]);
  const p = planRun(s, { kwh: 1, minutes: 60, now: T0, finishBy: T0 + 4 * H });
  assert.equal(p.best.start, T0 + H);
  assert.equal(p.best.cost, 10);
});

test("planRun explains when there isn't time", () => {
  const s = slots([30, 10, 10, 30]);
  assert.throws(() => planRun(s, { kwh: 1, minutes: 90, now: T0, finishBy: T0 + 60 * 60_000 }), /isn't enough time/);
  assert.throws(() => planRun(s, { kwh: 1, minutes: 300, now: T0 }), /aren't published far enough/);
});

test("greenest and balanced goals use the carbon forecast", () => {
  const s = slots([10, 10, 30, 30, 20, 20], [300, 300, 50, 50, 100, 100]);
  const cheap = planRun(s, { kwh: 1, minutes: 60, now: T0, goal: "cheapest" });
  const green = planRun(s, { kwh: 1, minutes: 60, now: T0, goal: "greenest" });
  const both = planRun(s, { kwh: 1, minutes: 60, now: T0, goal: "balanced" });
  assert.equal(cheap.best.start, T0);
  assert.equal(green.best.start, T0 + 2 * H);
  assert.equal(both.best.start, T0 + 4 * H); // middling on both counts
  assert.equal(green.best.carbon, 50);
});

test("greenest falls back to cheapest when no carbon is published", () => {
  const s = slots([30, 10, 10, 30]);
  assert.equal(planRun(s, { kwh: 1, minutes: 60, now: T0, goal: "greenest" }).best.start, T0 + H);
});

test("negative prices are a credit, and low water finds them", () => {
  const s = slots([20, -5, -3, 15]);
  const { low, high } = tideMarks(s, 60);
  assert.equal(low!.start, T0 + H);
  assert.equal(low!.avgPrice, -4);
  assert.equal(high!.start, T0);
});

test("a run already in progress starts mid-slot at 'now'", () => {
  const s = slots([10, 10, 10, 10]);
  const now = T0 + 10 * 60_000;
  const p = planRun(s, { kwh: 1, minutes: 60, now });
  assert.equal(p.now!.start, now);
  assert.ok(p.best.start >= now);
});
