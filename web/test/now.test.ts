/**
 * "Never dearer than now." Real-shaped prices captured on 15 October 2026: Octopus Agile for London (half-hourly,
 * with the regional carbon forecast), ComEd hourly for northern Illinois and EPEX day-ahead for Germany (hourly,
 * no carbon). A smoke test found plan_appliance answering "12:30, £3.96 instead of £3.90 now" for a 20 kWh car
 * top-up under the balanced goal: it traded 6p for 5% less carbon and didn't say so.
 */
for (const k of ["BLOB_READ_WRITE_TOKEN", "BEDROCK_ACCESS_KEY_ID", "BEDROCK_SECRET_ACCESS_KEY", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "S3_BUCKET"]) {
  delete process.env[k];
}
import { test } from "node:test";
import assert from "node:assert/strict";
import { planRun, type Goal } from "../lib/plan";
import { APPLIANCES, findAppliance } from "../lib/appliances";
import type { Region, Slot, Tide } from "../lib/grid/types";

const { planResult } = await import("../lib/mcp/tools");

const HALF = 30 * 60_000;
const HOUR = 60 * 60_000;

const LONDON: Region = {
  country: "GB", id: "GB-C", name: "London", place: "SW1A", timeZone: "Europe/London", currency: "GBP", unit: "p",
  tariff: "Octopus Agile", priceNote: "", carbonSource: "NESO regional carbon forecast",
};
const ILLINOIS: Region = {
  country: "US", id: "US-COMED", name: "Northern Illinois (ComEd)", place: "Chicago", timeZone: "America/Chicago", currency: "USD", unit: "¢",
  tariff: "ComEd Hourly Pricing", priceNote: "", carbonSource: null,
};
const GERMANY: Region = {
  country: "DE", id: "DE", name: "Germany", place: "Berlin", timeZone: "Europe/Berlin", currency: "EUR", unit: "ct",
  tariff: "EPEX day-ahead", priceNote: "", carbonSource: null,
};

// 11:30 BST to midnight, 15 Oct 2026 (London, region C).
const GB_START = Date.UTC(2026, 9, 15, 10, 30);
const GB_PRICE = [20.24, 19.66, 19.14, 19.46, 19.48, 19.22, 19.06, 25.06, 24.86, 45.82, 47.16, 51, 53.27, 53.85, 56.05, 40.78, 38.72, 38.08, 34.98, 35.4, 32.1, 31.54, 29.57];
const GB_CARBON = [102, 102, 107, 94, 91, 97, 83, 89, 102, 117, 132, 148, 160, 165, 165, 170, 175, 176, 183, 183, 181, 173, 158];
const US_START = Date.UTC(2026, 9, 15, 10, 0);
const US_PRICE = [4.5, 6.3, 8.8, 8, 6.8, 7.2, 7.2, 7.6, 7.6, 7.5, 7.6, 7, 9.2, 14, 12.1, 6.6, 6.4, 4.1, 2.7];
const DE_START = Date.UTC(2026, 9, 15, 10, 0);
const DE_PRICE = [11.37, 9.57, 10.06, 12.77, 17.46, 22.35, 24.55, 26.15, 23.16, 20.83, 20.08, 19.06];

const series = (start: number, step: number, prices: number[], carbon?: number[]): Slot[] =>
  prices.map((p, i) => ({ start: start + i * step, end: start + (i + 1) * step, price: p, carbon: carbon ? carbon[i] : null }));

const tideOf = (region: Region, slots: Slot[]): Tide => ({ region, slots, mix: null, fetchedAt: slots[0].start, sources: [] });
const GB = tideOf(LONDON, series(GB_START, HALF, GB_PRICE, GB_CARBON));
const US = tideOf(ILLINOIS, series(US_START, HOUR, US_PRICE));
const DE = tideOf(GERMANY, series(DE_START, HOUR, DE_PRICE));

const car = findAppliance("car")!;
const spokenOf = (tide: Tide, app = car, plan: ReturnType<typeof planRun>, now: number) => planResult(tide, app, plan, now).content[0].text;

test("the smoke-test case: a balanced pick that costs more than now says so, and why", () => {
  const now = Date.UTC(2026, 9, 15, 10, 35); // 11:35 BST
  const plan = planRun(GB.slots, { kwh: 20, minutes: 165, goal: "balanced", now });
  assert.equal(plan.best.start, Date.UTC(2026, 9, 15, 11, 30)); // 12:30 BST, as the smoke test saw
  assert.ok(plan.best.cost > plan.now!.cost);
  const r = planResult(GB, car, plan, now);
  const spoken = r.content[0].text;
  assert.match(spoken, /about 5 pence more than starting now, but 5% less carbon/);
  assert.match(spoken, /best balance of price and carbon/);
  assert.doesNotMatch(spoken, /less than starting now/);
  const sub = (r.structuredContent as { sub: string }).sub;
  assert.match(sub, /£3\.96: 5\.3p more than now for 5% less CO₂/);
  assert.doesNotMatch(sub, /instead of/);
});

test("under the cheapest goal the car goes earlier and cheaper, or starts now when now is cheapest", () => {
  const now = Date.UTC(2026, 9, 15, 10, 35);
  const top = planRun(GB.slots, { kwh: 20, minutes: 165, goal: "cheapest", now });
  assert.equal(top.best.start, Date.UTC(2026, 9, 15, 11, 0)); // 12:00 BST, cheaper than both now and 12:30
  assert.ok(top.best.cost < top.now!.cost);
  assert.match(spokenOf(GB, car, top, now), /pence less than starting now\./);
  const later = Date.UTC(2026, 9, 15, 10, 40);
  const full = planRun(GB.slots, { kwh: 30, minutes: 245, goal: "cheapest", now: later });
  assert.equal(full.best.start, later);
  assert.match(spokenOf(GB, car, full, later), /^Now's the cheapest time to charge the car: about £6\.13\.( Prices after 11 p\.m\. aren't out yet; tomorrow's come out around 4 p\.m\.)?$/);
});

test("greenest says what the cleaner start costs over now and over the cheapest", () => {
  const now = Date.UTC(2026, 9, 15, 10, 35);
  const plan = planRun(GB.slots, { kwh: 19, minutes: 165, goal: "greenest", now });
  assert.ok(plan.best.cost - plan.now!.cost >= 1);
  const spoken = spokenOf(GB, car, plan, now);
  assert.match(spoken, /the cleanest start\. It costs about £\d\.\d\d, about \d+ pence more than starting now, but \d+% less carbon\./);
  assert.doesNotMatch(spoken, /less than starting now/);
});

test("within half a penny of now, the cheapest goal doesn't send you to wait", () => {
  const s = series(GB_START, HALF, [20, 20, 19.8, 19.8, 30, 30]);
  const plan = planRun(s, { kwh: 1, minutes: 60, goal: "cheapest", now: GB_START });
  assert.equal(plan.best.start, GB_START); // 19.8p at 12:30 vs 20p now: 0.2p isn't worth waiting for
  assert.equal(plan.cheapest.start, GB_START + 2 * HALF); // the true minimum is still reported
});

test("greenest without a carbon forecast goes by price and says so", () => {
  const now = DE_START + 5 * 60_000;
  const plan = planRun(DE.slots, { kwh: 0.9, minutes: 180, goal: "greenest", now });
  assert.ok(plan.best.cost <= plan.now!.cost + 0.5);
  assert.match(spokenOf(DE, findAppliance("dishwasher")!, plan, now), /no carbon forecast here, so I went by price/);
});

// Every appliance, every goal, a start every thirteen minutes across the day, in all three markets.
for (const [name, tide] of [["Britain", GB], ["Illinois", US], ["Germany", DE]] as const) {
  test(`${name}: the cheapest goal is never dearer than now, and a greener pick that is dearer says so`, () => {
    let checked = 0;
    let dearer = 0;
    const end = tide.slots[tide.slots.length - 1].end;
    for (const app of APPLIANCES) {
      for (const kwh of [app.kwh, app.id === "ev" ? 20 : app.kwh]) {
        const minutes = app.id === "ev" ? Math.ceil(((kwh / 7.4) * 60) / 15) * 15 : app.minutes;
        for (const goal of ["cheapest", "greenest", "balanced"] as Goal[]) {
          for (let now = tide.slots[0].start + 60_000; now < end; now += 13 * 60_000) {
            let plan;
            try {
              plan = planRun(tide.slots, { kwh, minutes, goal, now });
            } catch {
              continue; // doesn't fit before the prices run out
            }
            if (!plan.now) continue;
            checked++;
            const spoken = spokenOf(tide, app, plan, now);
            const extra = plan.best.cost - plan.now.cost;
            if (goal === "cheapest" || !plan.greenest) {
              assert.ok(extra < 0.5, `${app.id} ${goal} at ${new Date(now).toISOString()}: ${plan.best.cost} vs ${plan.now.cost} now`);
              assert.doesNotMatch(spoken, /more than starting now/);
            } else if (extra >= 1 && plan.best.start - now >= 5 * 60_000) {
              dearer++;
              assert.match(spoken, /more than starting now, but (\d+%|a little) less carbon/, spoken);
              assert.ok(plan.best.carbon! < plan.now.carbon!, "a dearer pick must at least be cleaner");
            }
            if (/less than starting now/.test(spoken)) assert.ok(extra <= -1, spoken);
          }
        }
      }
    }
    assert.ok(checked > 100);
    if (name === "Britain") assert.ok(dearer > 0, "the British data includes greener-but-dearer picks");
  });
}
