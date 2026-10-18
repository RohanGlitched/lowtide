/**
 * "It needs to be done by seven." QA on 18 Oct 2026 (13:53 BST) heard "run at 8 p.m., done by 23:00" for the
 * judges' scripted dishwasher question: Nova passed "07:00", tomorrow's prices weren't out, and the answer never
 * said the deadline back. And "finished in ten minutes" for a 2.5-hour wash was quietly moved to tomorrow.
 */
for (const k of ["BLOB_READ_WRITE_TOKEN", "BEDROCK_ACCESS_KEY_ID", "BEDROCK_SECRET_ACCESS_KEY", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "S3_BUCKET"]) {
  delete process.env[k];
}
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDeadline } from "../lib/when";
import { findAppliance } from "../lib/appliances";
import type { Region, Slot, Tide } from "../lib/grid/types";

const { planAppliance } = await import("../lib/mcp/tools");

const LON = "Europe/London";
const HALF = 30 * 60_000;
const LONDON: Region = {
  country: "GB", id: "GB-C", name: "London", place: "SE1", timeZone: LON, currency: "GBP", unit: "p",
  tariff: "Octopus Agile", priceNote: "", carbonSource: null,
};
/** 18 Oct 2026, BST: `hh:mm` London time as unix ms (day 0 = the 18th, 1 = the 19th). */
const at = (hh: number, mm = 0, day = 0) => Date.UTC(2026, 9, 18 + day, hh - 1, mm);

/** Afternoon cheap, a 16:00-19:00 peak, a cheap night: Agile's usual shape. */
function priceAt(t: number): number {
  const h = new Date(t + 3600_000).getUTCHours();
  if (h >= 16 && h < 19) return 38;
  if (h >= 19 && h < 21) return 30;
  if (h >= 21 || h < 1) return 22;
  if (h < 6) return 14; // overnight low
  if (h < 13) return 24;
  return 25;
}
function tideUntil(end: number, from = at(13, 30)): Tide {
  const slots: Slot[] = [];
  for (let t = from; t < end; t += HALF) slots.push({ start: t, end: t + HALF, price: priceAt(t), carbon: null });
  return { region: LONDON, slots, mix: null, fetchedAt: from, sources: [] };
}
// Before Octopus publishes (about 16:00 UK) Agile runs to 23:00; after, to 23:00 tomorrow.
const BEFORE = tideUntil(at(23));
const AFTER = tideUntil(at(23, 0, 1));

const dish = findAppliance("dishwasher")!;
const wash = findAppliance("washing machine")!;
const DISH = { kwh: 0.9, minutes: 180 };
const WASH = { kwh: 0.8, minutes: 150 };
const spoken = (r: { content: { text: string }[] }) => r.content[0].text;
const view = (r: { structuredContent?: unknown }) => r.structuredContent as { headline: string; sub: string; facts: { label: string; value: string }[]; berths: { start: number; end: number }[] };

test("a bare 'seven' is the next seven the run can still make", () => {
  const afternoon = at(13, 48);
  assert.equal(resolveDeadline("seven", LON, afternoon, 180)?.at, at(19)); // 3 h fits before 7 p.m. today
  assert.equal(resolveDeadline("7", LON, afternoon, 180)?.at, at(19));
  assert.equal(resolveDeadline("7:00", LON, afternoon, 180)?.at, at(19));
  assert.equal(resolveDeadline("seven", LON, at(17, 0), 180)?.at, at(7, 0, 1)); // 3 h no longer fits before 19:00
  assert.equal(resolveDeadline("seven", LON, at(18, 30), 180)?.at, at(7, 0, 1));
  assert.equal(resolveDeadline("half seven", LON, afternoon, 60)?.at, at(19, 30));
  assert.equal(resolveDeadline("seven tomorrow", LON, afternoon, 180)?.at, at(7, 0, 1));
  assert.ok(resolveDeadline("seven", LON, afternoon, 180)?.ambiguous);
});

test("a time the person pinned down is taken as said, never moved", () => {
  const afternoon = at(13, 48);
  for (const s of ["7am", "7 a.m.", "07:00", "seven in the morning", "7am tomorrow"]) {
    const d = resolveDeadline(s, LON, afternoon, 180);
    assert.equal(d?.at, at(7, 0, 1), s);
    assert.equal(d?.ambiguous, false, s);
  }
  for (const s of ["7pm", "19:00", "seven tonight"]) assert.equal(resolveDeadline(s, LON, afternoon, 180)?.at, at(19), s);
  assert.equal(resolveDeadline("19:00", LON, at(18, 30), 180)?.at, at(19)); // too close, but not rolled to tomorrow
  assert.deepEqual(resolveDeadline("in ten minutes", LON, afternoon, 150), { at: afternoon + 10 * 60_000, ambiguous: false, relative: true });
  assert.equal(resolveDeadline("in 2 hours", LON, afternoon)?.at, afternoon + 2 * 3600_000);
  assert.equal(resolveDeadline("in half an hour", LON, afternoon)?.at, afternoon + 30 * 60_000);
  // what Nova actually sent on 18 Oct for "it has to be finished in ten minutes"
  assert.equal(resolveDeadline("ten minutes from now", LON, afternoon)?.at, afternoon + 10 * 60_000);
  assert.equal(resolveDeadline("in twenty minutes' time", LON, afternoon)?.at, afternoon + 20 * 60_000);
  assert.equal(resolveDeadline("90 mins from now", LON, afternoon)?.at, afternoon + 90 * 60_000);
  assert.equal(resolveDeadline("ten minutes", LON, afternoon)?.at, afternoon + 10 * 60_000); // and its second try
  assert.equal(resolveDeadline("2 hours", LON, afternoon)?.at, afternoon + 2 * 3600_000);
  assert.equal(resolveDeadline("teatime", LON, afternoon), null);
});

test("'done by seven' at 13:48 plans for this evening and says the deadline back", () => {
  const now = at(13, 48);
  const r = planAppliance(BEFORE, dish, DISH, { finish_by: "seven" }, now);
  const v = view(r);
  assert.ok(v.berths[0].end <= at(19), "finishes by 7 p.m.");
  assert.match(spoken(r), /in time for 7 p\.m\. this evening\./);
  assert.match(v.sub, /deadline 19:00/);
  assert.ok(v.facts.some((f) => f.label === "Done by" && /deadline 19:00/.test(f.value)));
  assert.doesNotMatch(spoken(r), /aren't out yet/); // the deadline is inside the published prices
});

test("'done by seven' in the evening plans overnight for 7 a.m. and says so", () => {
  const now = at(18, 30);
  const r = planAppliance(AFTER, dish, DISH, { finish_by: "seven" }, now);
  const v = view(r);
  assert.ok(v.berths[0].end <= at(7, 0, 1));
  assert.ok(v.berths[0].start >= at(1, 0, 1), "uses the overnight low");
  assert.match(spoken(r), /in time for 7 a\.m\. tomorrow morning\./);
});

test("a deadline past the published prices says tomorrow's aren't out yet, briefly", () => {
  const now = at(13, 48);
  const r = planAppliance(BEFORE, dish, DISH, { finish_by: "7am" }, now);
  assert.match(spoken(r), /in time for 7 a\.m\. tomorrow morning/);
  assert.match(spoken(r), /Prices after 11 p\.m\. aren't out yet; tomorrow's come out around 4 p\.m\.$/);
  const after = planAppliance(AFTER, dish, DISH, { finish_by: "7am" }, at(16, 30));
  assert.doesNotMatch(spoken(after), /aren't out yet/);
});

test("a deadline too close for the run says it can't, and offers the earliest finish", () => {
  const now = at(13, 53);
  for (const finish_by of ["in ten minutes", "13:53", "2pm"]) {
    const r = planAppliance(BEFORE, wash, WASH, { finish_by }, now);
    assert.ok(!("isError" in r && r.isError), finish_by);
    assert.match(spoken(r), /^The washing machine takes 2 and a half hours, so it can't be done by .+\. Starting now, it would finish at 4:23 p\.m\., for about \d+ pence\./, finish_by);
    assert.match(view(r).headline, /^Can't be done by \d\d:\d\d$/);
    assert.ok(view(r).facts.some((f) => f.label === "Earliest finish" && f.value === "16:23, starting now"));
    assert.doesNotMatch(spoken(r), /tomorrow morning|instead of/);
  }
  // the 18 Oct transcript: Nova also invented start_after "ten"; the deadline still wins and the answer is "can't"
  assert.match(spoken(planAppliance(BEFORE, wash, WASH, { finish_by: "ten minutes from now", start_after: "ten" }, now)), /can't be done by 2:03 p\.m\./);
  // a pinned clock time offers tomorrow's; a relative one ("in ten minutes") doesn't
  assert.match(spoken(planAppliance(BEFORE, wash, WASH, { finish_by: "2pm" }, now)), /Or I can plan it for 2 p\.m\. tomorrow\.$/);
  assert.doesNotMatch(spoken(planAppliance(BEFORE, wash, WASH, { finish_by: "in ten minutes" }, now)), /tomorrow/);
});

test("'by 19:00' asked at 18:30 isn't moved to tomorrow; 'by seven' is read as tomorrow morning", () => {
  const now = at(18, 30);
  assert.match(spoken(planAppliance(AFTER, dish, DISH, { finish_by: "19:00" }, now)), /can't be done by 7 p\.m\./);
  assert.match(spoken(planAppliance(AFTER, dish, DISH, { finish_by: "seven" }, now)), /in time for 7 a\.m\. tomorrow morning/);
});
