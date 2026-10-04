import { test } from "node:test";
import assert from "node:assert/strict";
import { clock, dayPart, spokenTime, zonedToUtc } from "../lib/grid/time";
import { nextClockTime } from "../lib/when";
import { parseComed } from "../lib/grid/us";
import { parsePostcode } from "../lib/grid/uk";
import { resolveCountry } from "../lib/grid";
import { findAppliance } from "../lib/appliances";
import { money, moneySpoken, rate } from "../lib/format";

const LON = "Europe/London";

test("zonedToUtc handles summer time and the clocks going back", () => {
  assert.equal(zonedToUtc(2026, 6, 1, 12, 0, LON), Date.UTC(2026, 6, 1, 11, 0)); // BST
  assert.equal(zonedToUtc(2026, 11, 1, 12, 0, LON), Date.UTC(2026, 11, 1, 12, 0)); // GMT
  assert.equal(zonedToUtc(2026, 9, 4, 0, 0, "America/Chicago"), Date.UTC(2026, 9, 4, 5, 0)); // CDT
});

test("nextClockTime reads spoken and written times and rolls to tomorrow", () => {
  const now = Date.UTC(2026, 9, 4, 15, 0); // 16:00 London
  assert.equal(nextClockTime("07:00", LON, now), Date.UTC(2026, 9, 5, 6, 0));
  assert.equal(nextClockTime("7am", LON, now), Date.UTC(2026, 9, 5, 6, 0));
  assert.equal(nextClockTime("7:30 p.m.", LON, now), Date.UTC(2026, 9, 4, 18, 30));
  assert.equal(nextClockTime("midnight", LON, now), Date.UTC(2026, 9, 4, 23, 0));
  assert.equal(nextClockTime("noon", LON, now), Date.UTC(2026, 9, 5, 11, 0));
  assert.equal(nextClockTime("2026-10-05T00:00:00.000Z", LON, now), Date.UTC(2026, 9, 5, 0, 0));
  assert.equal(nextClockTime("teatime", LON, now), null);
  assert.equal(nextClockTime("25:00", LON, now), null);
});

test("times read the way people say them", () => {
  const now = Date.UTC(2026, 9, 4, 15, 0);
  const oneThirty = Date.UTC(2026, 9, 5, 0, 30); // 01:30 BST
  assert.equal(clock(oneThirty, LON), "01:30");
  assert.equal(spokenTime(oneThirty, LON), "1:30 a.m.");
  assert.equal(dayPart(oneThirty, now, LON), "tonight");
  assert.equal(dayPart(Date.UTC(2026, 9, 5, 9, 0), now, LON), "tomorrow morning");
  assert.equal(spokenTime(Date.UTC(2026, 9, 4, 23, 0), LON), "midnight");
});

test("ComEd's feed is Chicago wall-clock time", () => {
  const rows = parseComed("[[Date.UTC(2026,9,4,0,0,0), 3.6], [Date.UTC(2026,9,4,1,0,0), -0.4]]");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].start, Date.UTC(2026, 9, 4, 5, 0));
  assert.equal(rows[1].price, -0.4);
});

test("places resolve to the right tariff region", () => {
  assert.deepEqual(parsePostcode("sw1a 2aa"), { outward: "SW1A", full: "SW1A2AA" });
  assert.deepEqual(parsePostcode("M1"), { outward: "M1", full: "M1" });
  assert.equal(parsePostcode("Chicago"), null);
  assert.equal(resolveCountry("SE1 7PB"), "GB");
  assert.equal(resolveCountry("Chicago"), "US");
  assert.equal(resolveCountry("60614"), "US");
  assert.equal(resolveCountry("Berlin"), "DE");
  assert.throws(() => resolveCountry("Paris"), /covers Britain/);
});

test("appliances are found by everyday names", () => {
  assert.equal(findAppliance("the dishwasher")?.id, "dishwasher");
  assert.equal(findAppliance("laundry")?.id, "washing-machine");
  assert.equal(findAppliance("washer dryer")?.id, "tumble-dryer");
  assert.equal(findAppliance("Tesla")?.id, "ev");
  assert.equal(findAppliance("immersion")?.id, "hot-water");
  assert.equal(findAppliance("kettle"), null);
});

test("money reads naturally in each currency", () => {
  const gb = { currency: "GBP" as const, unit: "p" as const };
  assert.equal(money(19.4, gb), "19p");
  assert.equal(money(234, gb), "£2.34");
  assert.equal(money(-3, gb), "−3p");
  assert.equal(moneySpoken(22, gb), "22 pence");
  assert.equal(moneySpoken(1, gb), "1 penny");
  assert.equal(money(8, { currency: "USD" }), "8¢");
  assert.equal(money(105, { currency: "EUR" }), "€1.05");
  assert.equal(rate(6.1, gb), "6.1p/kWh");
  assert.equal(rate(9.25, { unit: "ct" }), "9.3 ct/kWh");
});
