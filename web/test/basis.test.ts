/**
 * "Cheapest" and "now" on the same basis, everywhere. QA on 18 Oct 2026 found the home picker saying "at the
 * cheapest time" cost more than "switched on now" (it never tried starting now), the home answer reading "29p
 * instead of 29p now", and "cheapest hour 13:30, 26.8p" shown beside "now 25.6p" on the home stats, every /tables
 * dial and get_tide's sentence (an hourly mean against a half-hour price).
 */
for (const k of ["BLOB_READ_WRITE_TOKEN", "BEDROCK_ACCESS_KEY_ID", "BEDROCK_SECRET_ACCESS_KEY", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "S3_BUCKET"]) {
  delete process.env[k];
}
import { test } from "node:test";
import assert from "node:assert/strict";
import { cheapAndDear, planRun } from "../lib/plan";
import { pickPlan } from "../lib/picker";
import { APPLIANCES } from "../lib/appliances";
import type { Region, Slot, Tide } from "../lib/grid/types";

const { planResult } = await import("../lib/mcp/tools");

const HALF = 30 * 60_000;
const T0 = Date.UTC(2026, 9, 18, 12, 30); // 13:30 BST
const LONDON: Region = {
  country: "GB", id: "GB-C", name: "London", place: "SE1", timeZone: "Europe/London", currency: "GBP", unit: "p",
  tariff: "Octopus Agile", priceNote: "", carbonSource: null,
};
const slotsOf = (prices: number[], start = T0): Slot[] => prices.map((p, i) => ({ start: start + i * HALF, end: start + (i + 1) * HALF, price: p, carbon: null }));
const tideOf = (slots: Slot[]): Tide => ({ region: LONDON, slots, mix: null, fetchedAt: slots[0].start, sources: [] });

/** A small deterministic generator, so the sweeps are the same on every run. */
function rng(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}
function randomDay(r: () => number, n = 40): number[] {
  let p = 15 + r() * 15;
  return Array.from({ length: n }, () => (p = Math.max(-2, Math.min(60, p + (r() - 0.5) * 8))));
}

test("the QA case: 25.6p now, 28p next: the cheapest half hour is now, not 13:30 at 26.8p", () => {
  const s = slotsOf([25.6, 28, 30, 32, 38, 41, 40, 35, 31, 29, 27, 26.2]);
  const now = T0 + 17 * 60_000; // 13:47
  const { low, high } = cheapAndDear(s, now);
  assert.equal(low!.isNow, true);
  assert.equal(low!.avgPrice, 25.6);
  assert.equal(high!.avgPrice, 41);
});

test("cheapest is never dearer than now, on any day (half hour against half hour)", () => {
  const r = rng(7);
  for (let day = 0; day < 300; day++) {
    const s = slotsOf(randomDay(r));
    const now = T0 + Math.floor(r() * 10 * HALF);
    const cur = s.find((x) => x.start <= now && now < x.end)!;
    const { low } = cheapAndDear(s, now);
    assert.ok(low!.avgPrice <= cur.price, `day ${day}: ${low!.avgPrice} vs ${cur.price}`);
    if (low!.avgPrice === cur.price) assert.equal(low!.isNow, true, "a tie with now is now");
    assert.ok(low!.end > now, "never a half hour that's already over");
  }
});

test("the home picker considers starting now, so 'at the cheapest time' never costs more than 'switched on now'", () => {
  // The QA numbers: washing 24p now vs 25p at 20:30; hot water £1.66 now vs £1.68 at 14:00.
  const r = rng(11);
  let startsNow = 0;
  for (let day = 0; day < 200; day++) {
    const slots = slotsOf(randomDay(r, 60)).map((x) => ({ s: x.start, e: x.end, p: x.price }));
    const now = T0 + Math.floor(r() * HALF);
    for (const load of [{ kwh: 0.8, minutes: 150 }, { kwh: 6, minutes: 120 }, { kwh: 0.9, minutes: 180 }]) {
      const plan = pickPlan(slots, now, load);
      if (plan.nowC == null || !plan.best) continue;
      assert.ok(plan.best.c <= plan.nowC, `${plan.best.c} at the cheapest time vs ${plan.nowC} now`);
      if (plan.startsNow) startsNow++;
      else assert.ok(plan.nowC - plan.best.c >= 1, "waiting must save at least a penny");
    }
  }
  assert.ok(startsNow > 0);
});

test("the planner's answer never reads 'Xp instead of Xp now', or a saving that rounds to nothing", () => {
  const r = rng(3);
  let checked = 0;
  for (let day = 0; day < 150; day++) {
    const tide = tideOf(slotsOf(randomDay(r, 48)));
    for (const app of APPLIANCES) {
      const now = T0 + Math.floor(r() * HALF);
      let plan;
      try {
        plan = planRun(tide.slots, { kwh: app.kwh, minutes: app.minutes, now });
      } catch {
        continue;
      }
      checked++;
      const res = planResult(tide, app, plan, now);
      const sub = (res.structuredContent as { sub: string }).sub;
      const same = sub.match(/(\S+) instead of (\S+) now/);
      if (same) assert.notEqual(same[1], same[2], sub);
      assert.doesNotMatch(res.content[0].text, /\b0 pence less\b/);
    }
  }
  assert.ok(checked > 300);
});

test("a saving under a penny isn't worth the wait: now wins", () => {
  const s = slotsOf([29.4, 29.4, 29.4, 29.4, 29.4, 29.4, 40, 40, 28.9, 28.9, 28.9, 28.9, 28.9, 28.9]);
  const plan = planRun(s, { kwh: 0.9, minutes: 180, now: T0 + 60_000 });
  assert.equal(plan.best.start, T0 + 60_000);
  const sub = (planResult(tideOf(s), APPLIANCES[0], plan, T0 + 60_000).structuredContent as { sub: string }).sub;
  assert.doesNotMatch(sub, /instead of/);
});
