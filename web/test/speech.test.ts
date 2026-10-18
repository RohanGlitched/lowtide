import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePlace, resolveCountry } from "../lib/grid";
import { resolveDeadline } from "../lib/when";

const TZ = "Europe/London";
// Sunday 18 October 2026, 19:00 in London (BST, UTC+1).
const NOW = Date.UTC(2026, 9, 18, 18, 0);
const at = (input: string, role: "deadline" | "start" = "deadline", minutes = 0) => resolveDeadline(input, TZ, NOW, minutes, role)?.at;
const london = (d: number, h: number, m = 0) => Date.UTC(2026, 9, d, h - 1, m);

test("British cities and Agile regions are accepted where a postcode is", () => {
  assert.equal(normalizePlace("London"), "SE1 7PB");
  assert.equal(normalizePlace("manchester, UK"), "M1 1AE");
  assert.equal(normalizePlace("South Wales"), "CF10 1EP");
  assert.equal(normalizePlace("the North East"), "NE1 7RU");
  assert.equal(normalizePlace("SW1A 2AA"), "SW1A 2AA");
  assert.equal(resolveCountry("Glasgow"), "GB");
  assert.equal(resolveCountry("Yorkshire"), "GB");
});

test("places outside the covered markets get a plain answer", () => {
  assert.throws(() => resolveCountry("BT1 1AA"), /Northern Ireland isn't on Octopus Agile/);
  assert.throws(() => resolveCountry("Springfield, Illinois"), /Ameren/);
  assert.throws(() => resolveCountry("62701"), /Ameren/);
  assert.equal(resolveCountry("60614"), "US");
  assert.equal(resolveCountry("Rockford"), "US");
  assert.equal(resolveCountry("10115"), "DE");
});

test("parts of the day said as words are read as deadlines", () => {
  assert.equal(at("tomorrow morning"), london(19, 7));
  assert.equal(at("by the morning"), london(19, 7));
  assert.equal(at("before I wake up"), london(19, 7));
  assert.equal(at("first thing in the morning"), london(19, 7));
  assert.equal(at("by tomorrow"), london(19, 7));
  assert.equal(at("tonight"), london(18, 22));
  assert.equal(at("this afternoon"), london(19, 17));
});

test("start times: 'after', 'from', 'not before', and a part of the day already under way", () => {
  assert.equal(at("after 10pm", "start"), london(18, 22));
  assert.equal(at("not before 10pm", "start"), london(18, 22));
  assert.equal(at("from ten", "start") !== undefined, true);
  // 7 p.m. is inside "tonight" (18:00 to 22:00), so it can start now.
  assert.equal(at("tonight", "start"), NOW);
});

test("clock times still read as before", () => {
  assert.equal(at("7am"), london(19, 7));
  assert.equal(at("22:00"), london(18, 22));
  assert.equal(resolveDeadline("in two hours", TZ, NOW)?.relative, true);
});

test("'not before 10pm, done by 10pm' plans the night, not 'it can't be done'", async () => {
  const { planAppliance } = await import("../lib/mcp/tools");
  const { findAppliance } = await import("../lib/appliances");
  const slots = Array.from({ length: 96 }, (_, i) => ({ start: NOW - 3600_000 + i * 1800_000, end: NOW - 3600_000 + (i + 1) * 1800_000, price: 20 + (i % 48 < 20 ? 0 : 15), carbon: null }));
  const tide = { region: { id: "GB-C", name: "London", country: "GB", currency: "GBP", unit: "p", tariff: "Agile", timeZone: TZ }, slots, mix: null, fetchedAt: NOW, sources: [] } as never;
  const app = findAppliance("car")!;
  const r = planAppliance(tide, app, { kwh: 30, minutes: 240 }, { start_after: "not before 10pm", finish_by: "10pm" }, NOW);
  const text = r.content[0].text;
  assert.doesNotMatch(text, /can't be done/);
  assert.match(text, /10(:\d\d)? p\.m\.|11 p\.m\.|midnight|a\.m\./);
});
