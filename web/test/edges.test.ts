/**
 * Edge cases and regressions found in review. Plain tests pin behaviour that is correct today.
 * Tests marked `todo` reproduce a known bug: they fail now (reported as TODO, not as a failure)
 * and should pass once the bug is fixed, at which point the `todo` flag can be removed.
 *
 * The second half drives the real MCP tool handlers and two route handlers in-process. Modules that
 * import "server-only" are loaded through a tiny resolve hook that maps it to an empty module, the
 * network is replaced with a stubbed fetch, and households are written to a temp dir, never the repo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { costRun, planRun, tideMarks } from "../lib/plan";
import { offsetMs, zonedToUtc } from "../lib/grid/time";
import { nextClockTime } from "../lib/when";
import { parseComed } from "../lib/grid/us";
import { APPLIANCES, findAppliance } from "../lib/appliances";
import { duration, grams, money, moneySpoken, rate } from "../lib/format";
import { fallbackTurn } from "../lib/alexa/fallback";
import type { Slot } from "../lib/grid/types";
import type { Message } from "../lib/alexa/types";

/* ------------------------------------------------------------------ in-process harness */
// Set up before any test is registered: node:test starts running tests while a top-level await is pending,
// so the working directory and imports must be settled first.
// Households go to a throwaway directory; no Blob token, no Bedrock key, no real network.
const ORIGINAL_CWD = process.cwd();
const TMP = mkdtempSync(path.join(tmpdir(), "lowtide-edges-"));
process.chdir(TMP);
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.AWS_BEARER_TOKEN_BEDROCK;
delete process.env.BEDROCK_ACCESS_KEY_ID;
delete process.env.BEDROCK_SECRET_ACCESS_KEY;
process.on("exit", () => {
  process.chdir(ORIGINAL_CWD); // Windows can't remove the current directory
  rmSync(TMP, { recursive: true, force: true });
});

register(
  "data:text/javascript,export async function resolve(s,c,n){if(s==='server-only')return{url:'data:text/javascript,export{}',shortCircuit:true};return n(s,c)}",
  import.meta.url,
);

// aWATTar stub for Germany: hourly prices from three hours ago to a day ahead. Cheap in the past, dear now.
let BASE = 0;
const DE_PRICE = (h: number) => (h < 0 ? 1 : h === 0 ? 50 : h === 5 || h === 6 ? 2 : 30); // ct/kWh
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("https://api.awattar.de/")) {
    if (!BASE) BASE = Math.floor(Date.now() / HOUR) * HOUR;
    const data = [];
    for (let h = -3; h < 24; h++) {
      data.push({ start_timestamp: BASE + h * HOUR, end_timestamp: BASE + (h + 1) * HOUR, marketprice: DE_PRICE(h) * 10, unit: "Eur/MWh" });
    }
    return Response.json({ data });
  }
  if (url.startsWith("https://hourlypricing.comed.com/")) {
    // Only hours starting two hours from now: there is no price for the current hour.
    const rows: string[] = [];
    const first = Math.floor(Date.now() / HOUR) * HOUR + 2 * HOUR;
    for (let i = 0; i < 12; i++) {
      const t = first + i * HOUR;
      const l = new Date(t + offsetMs(t, CHI));
      rows.push(`[Date.UTC(${l.getUTCFullYear()},${l.getUTCMonth()},${l.getUTCDate()},${l.getUTCHours()},0,0), 3.1]`);
    }
    return new Response(url.includes("tomorrow") ? "[]" : `[${rows.join(", ")}]`);
  }
  return new Response("nope", { status: 500 });
}) as typeof fetch;

const { registerLowtide } = await import("../lib/mcp/tools");
const { createHome, loadHome, newHomeId, HOME_ID } = await import("../lib/store");
const homes = await import("../app/api/homes/route");
const alexa = await import("../app/api/alexa/route");

const LON = "Europe/London";
const CHI = "America/Chicago";
const H = 30 * 60_000;
const HOUR = 2 * H;
const T0 = Date.UTC(2026, 9, 4, 16, 0); // 17:00 London (BST)
const GB = { currency: "GBP" as const, unit: "p" as const };
const US = { currency: "USD" as const, unit: "¢" as const };
const EU = { currency: "EUR" as const, unit: "ct" as const };

function slots(prices: number[], carbon?: (number | null)[], from = T0, step = H): Slot[] {
  return prices.map((p, i) => ({ start: from + i * step, end: from + (i + 1) * step, price: p, carbon: carbon ? carbon[i] : null }));
}
const errOf = (f: () => unknown): string => {
  try {
    f();
    return "";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

/* ------------------------------------------------------------------ clocks and DST */

test("zonedToUtc: London's clocks going back (25 Oct 2026) resolve the repeated hour to the later, GMT, 01:xx", () => {
  assert.equal(zonedToUtc(2026, 9, 25, 0, 59, LON), Date.UTC(2026, 9, 24, 23, 59)); // still BST
  assert.equal(zonedToUtc(2026, 9, 25, 1, 30, LON), Date.UTC(2026, 9, 25, 1, 30)); // second 01:30 (GMT)
  assert.equal(zonedToUtc(2026, 9, 25, 2, 0, LON), Date.UTC(2026, 9, 25, 2, 0));
  // A wall time that doesn't exist (spring forward, 29 Mar 2026 01:30) lands an hour later, never throws.
  assert.equal(zonedToUtc(2026, 2, 29, 1, 30, LON), Date.UTC(2026, 2, 29, 1, 30)); // = 02:30 BST
});

test("zonedToUtc: Chicago's repeated hour (1 Nov 2026) resolves to the earlier, CDT, 01:xx (opposite of London)", () => {
  assert.equal(zonedToUtc(2026, 10, 1, 1, 0, CHI), Date.UTC(2026, 10, 1, 6, 0)); // 01:00 CDT
  assert.equal(zonedToUtc(2026, 10, 1, 1, 30, CHI), Date.UTC(2026, 10, 1, 6, 30));
  assert.equal(zonedToUtc(2026, 10, 1, 2, 0, CHI), Date.UTC(2026, 10, 1, 8, 0)); // 02:00 CST
  assert.equal(offsetMs(Date.UTC(2026, 10, 1, 7, 30), CHI), -6 * 3600_000);
});

test("nextClockTime reads the ways people write a time", () => {
  const now = Date.UTC(2026, 9, 4, 15, 0); // 16:00 BST
  const today = (h: number, m = 0) => Date.UTC(2026, 9, 4, h - 1, m);
  const tomorrow = (h: number, m = 0) => Date.UTC(2026, 9, 5, h - 1, m);
  assert.equal(nextClockTime("7", LON, now), tomorrow(7)); // bare hour is a.m.
  assert.equal(nextClockTime("7.30pm", LON, now), today(19, 30));
  assert.equal(nextClockTime("19:00", LON, now), today(19));
  assert.equal(nextClockTime("19h30", LON, now), today(19, 30));
  assert.equal(nextClockTime("1930", LON, now), today(19, 30));
  assert.equal(nextClockTime("  7 PM ", LON, now), today(19));
  assert.equal(nextClockTime("7 p.m.", LON, now), today(19));
  assert.equal(nextClockTime("12am", LON, now), Date.UTC(2026, 9, 4, 23, 0));
  assert.equal(nextClockTime("12pm", LON, now), tomorrow(12));
  assert.equal(nextClockTime("midday", LON, now), tomorrow(12));
});

test("nextClockTime refuses what it can't read instead of guessing", () => {
  const now = Date.UTC(2026, 9, 4, 15, 0);
  for (const s of ["", "7:5", "24:00", "7:60", "half seven", "2026-10-05", "tomorrow 7am", "7 o'clock", "-1"]) {
    assert.equal(nextClockTime(s, LON, now), null, JSON.stringify(s));
  }
});

test("nextClockTime: a time equal to now rolls to tomorrow; a full ISO time is taken as-is", () => {
  const now = Date.UTC(2026, 9, 4, 18, 30); // 19:30 BST exactly
  assert.equal(nextClockTime("19:30", LON, now), Date.UTC(2026, 9, 5, 18, 30));
  assert.equal(nextClockTime("2026-10-05T00:30:00.000Z", LON, now), Date.UTC(2026, 9, 5, 0, 30));
  assert.equal(nextClockTime("2026-10-05T01:30:00+01:00", LON, now), Date.UTC(2026, 9, 5, 0, 30));
});

test("nextClockTime across London's clocks going back: 07:00 tomorrow is 07:00 GMT", () => {
  const now = Date.UTC(2026, 9, 24, 22, 30); // Sat 23:30 BST
  assert.equal(nextClockTime("07:00", LON, now), Date.UTC(2026, 9, 25, 7, 0));
  assert.equal(nextClockTime("23:15", LON, now), Date.UTC(2026, 9, 25, 23, 15)); // rolls to Sunday, GMT
  assert.equal(nextClockTime("midnight", LON, now), Date.UTC(2026, 9, 24, 23, 0)); // 00:00 BST
});

test("nextClockTime across Chicago's clocks going back: 07:00 tomorrow is 07:00 CST", () => {
  const now = Date.UTC(2026, 10, 1, 3, 0); // Sat 31 Oct 22:00 CDT
  assert.equal(nextClockTime("07:00", CHI, now), Date.UTC(2026, 10, 1, 13, 0));
  assert.equal(nextClockTime("9pm", CHI, now), Date.UTC(2026, 10, 2, 3, 0)); // Sun 21:00 CST
});

test(
  "nextClockTime rolling to tomorrow on the eve of spring-forward lands on the right day",
  () => {
    // Sat 28 Mar 2026 23:30 GMT: "23:15" has passed, so the answer is Sun 29 Mar 23:15 BST (22:15Z).
    assert.equal(nextClockTime("23:15", LON, Date.UTC(2026, 2, 28, 23, 30)), Date.UTC(2026, 2, 29, 22, 15));
    // Sat 7 Mar 2026 23:30 CST: answer is Sun 8 Mar 23:15 CDT (04:15Z on the 9th).
    assert.equal(nextClockTime("23:15", CHI, Date.UTC(2026, 2, 8, 5, 30)), Date.UTC(2026, 2, 9, 4, 15));
  },
);

test(
  "nextClockTime reads an ISO time without an offset in the household's zone, not the server's",
  () => {
    const prev = process.env.TZ;
    process.env.TZ = "UTC"; // what Vercel runs in
    try {
      assert.equal(nextClockTime("2026-10-05T07:00", LON, Date.UTC(2026, 9, 4, 15, 0)), Date.UTC(2026, 9, 5, 6, 0));
    } finally {
      if (prev === undefined) delete process.env.TZ;
      else process.env.TZ = prev;
    }
  },
);

/* ------------------------------------------------------------------ ComEd */

test("parseComed: ignores junk around the feed and keeps negative prices", () => {
  const rows = parseComed("var x = [[Date.UTC(2026,9,4,23,0,0), -1.25], garbage, [Date.UTC(2026,9,4,22,0,0), 4]];");
  assert.equal(rows.length, 2);
  assert.ok(rows[0].start < rows[1].start, "sorted");
  assert.equal(rows[1].price, -1.25);
  assert.equal(rows[0].start, Date.UTC(2026, 9, 5, 3, 0)); // 22:00 CDT
});

test(
  "parseComed: the repeated 1 a.m. on 1 Nov 2026 becomes two distinct hours",
  () => {
    const rows = parseComed(
      "[[Date.UTC(2026,10,1,0,0,0), 3.0], [Date.UTC(2026,10,1,1,0,0), 2.0], [Date.UTC(2026,10,1,1,0,0), 1.5], [Date.UTC(2026,10,1,2,0,0), 2.5]]",
    );
    assert.deepEqual(
      rows.map((r) => r.start),
      [Date.UTC(2026, 10, 1, 5), Date.UTC(2026, 10, 1, 6), Date.UTC(2026, 10, 1, 7), Date.UTC(2026, 10, 1, 8)],
    );
  },
);

/* ------------------------------------------------------------------ planner */

test("costRun: a stretch with a hole in the prices is null; one ending exactly at the horizon is priced", () => {
  const s = [...slots([10, 10]), ...slots([1, 1], undefined, T0 + 3 * H)]; // no price for slot 2
  assert.equal(costRun(s, T0 + H, 60, 1), null);
  assert.equal(costRun(s, T0 + 2 * H, 30, 1), null);
  const r = costRun(s, T0 + 3 * H, 60, 1)!;
  assert.equal(r.cost, 1);
  assert.equal(r.end, T0 + 5 * H);
  // Partial slots at both ends are weighted by time.
  assert.equal(costRun(slots([10, 20, 30]), T0 + H / 2, 60, 2)!.cost, 0.5 * 10 + 20 + 0.5 * 30);
});

test("planRun skips starts that cross a gap, and says so when every start does", () => {
  const s = [...slots([10, 10]), ...slots([1, 1, 1, 1], undefined, T0 + 3 * H)];
  const p = planRun(s, { kwh: 1, minutes: 60, now: T0 });
  assert.equal(p.best.start, T0 + 3 * H);
  assert.throws(() => planRun(s, { kwh: 1, minutes: 150, now: T0, finishBy: T0 + 5 * H }), /have a gap/);
});

test("planRun with negative prices: the best run is a credit, and the comparison with now still holds", () => {
  const s = slots([5, -10, -10, 5, 20]);
  const p = planRun(s, { kwh: 2, minutes: 60, now: T0 });
  assert.equal(p.best.start, T0 + H);
  assert.equal(p.best.cost, -20);
  assert.equal(p.best.avgPrice, -10);
  assert.equal(p.now!.cost, -5);
  assert.equal(p.priciest.cost, 25); // 5p then 20p
  assert.equal(money(p.best.cost, GB), "−20p");
  assert.equal(moneySpoken(p.best.cost, GB), "20 pence back");
});

test("planRun explains an impossible deadline and a horizon that's too short", () => {
  const s = slots([30, 20, 10, 5, 5, 10, 20, 30]);
  assert.match(errOf(() => planRun(s, { kwh: 1, minutes: 60, now: T0, finishBy: T0 - H })), /isn't enough time/);
  assert.match(errOf(() => planRun(s, { kwh: 1, minutes: 60, now: T0, finishBy: T0 + H })), /isn't enough time/);
  assert.match(errOf(() => planRun(s, { kwh: 1, minutes: 60, now: T0, earliest: T0 + 20 * H })), /aren't published far enough/);
  assert.match(errOf(() => planRun([], { kwh: 1, minutes: 60, now: T0 })), /No prices/);
  // A deadline beyond the published prices is clipped to the horizon, not refused.
  assert.equal(planRun(s, { kwh: 1, minutes: 60, now: T0, finishBy: T0 + 99 * H }).best.start, T0 + 3 * H);
});

test(
  "planRun: an earliest start after the deadline isn't reported as 'not enough time, even starting now'",
  () => {
    const s = slots(new Array(40).fill(10));
    const msg = errOf(() => planRun(s, { kwh: 1, minutes: 60, now: T0, earliest: T0 + 30 * H, finishBy: T0 + 12 * H }));
    assert.ok(msg, "should still refuse");
    assert.doesNotMatch(msg, /even starting now/);
  },
);

test("planRun: equal prices start now; hourly feeds still get half-hour starts; a later earliest has no 'now' run", () => {
  const flat = planRun(slots([7, 7, 7, 7]), { kwh: 1, minutes: 60, now: T0 + 5 * 60_000 });
  assert.equal(flat.best.start, T0 + 5 * 60_000);
  const hourly = slots([10, 2, 8, 10], undefined, T0, HOUR);
  assert.equal(planRun(hourly, { kwh: 1, minutes: 60, now: T0 }).best.start, T0 + HOUR);
  assert.equal(planRun(hourly, { kwh: 1, minutes: 30, now: T0 }).best.start, T0 + HOUR); // ties: earliest
  const later = planRun(slots([9, 9, 1, 1, 9]), { kwh: 1, minutes: 60, now: T0, earliest: T0 + H });
  assert.equal(later.now, null);
  assert.equal(later.best.start, T0 + 2 * H);
});

test("planRun balanced: ties go to the earlier start; without carbon it is simply the cheapest", () => {
  const s = slots([10, 20, 20, 10], [20, 10, 10, 20]);
  assert.equal(planRun(s, { kwh: 1, minutes: 30, now: T0, goal: "balanced" }).best.start, T0);
  const noCarbon = slots([30, 10, 20]);
  const p = planRun(noCarbon, { kwh: 1, minutes: 30, now: T0, goal: "balanced" });
  assert.equal(p.best.start, T0 + H);
  assert.equal(p.greenest, null);
  // All costs equal: balanced follows carbon alone.
  const sameCost = slots([10, 10, 10], [300, 100, 200]);
  assert.equal(planRun(sameCost, { kwh: 1, minutes: 30, now: T0, goal: "balanced" }).best.start, T0 + H);
});

test(
  "planRun greenest still works when the carbon forecast is missing for one slot",
  () => {
    const s = slots([10, 10, 30, 30, 20, 20], [300, 300, 50, 50, 100, null]);
    assert.equal(planRun(s, { kwh: 1, minutes: 60, now: T0, goal: "greenest" }).best.start, T0 + 2 * H);
  },
);

test("tideMarks: too few slots for the window gives no marks; one slot an hour long is enough", () => {
  assert.deepEqual(tideMarks(slots([5]), 60), { low: null, high: null });
  assert.deepEqual(tideMarks([], 60), { low: null, high: null });
  const hourly = slots([4], undefined, T0, HOUR);
  assert.equal(tideMarks(hourly, 60).low!.avgPrice, 4);
});

/* ------------------------------------------------------------------ money, rates, durations */

test("money: the £1.00 boundary, negatives and each currency", () => {
  assert.equal(money(100, GB), "£1.00");
  assert.equal(money(99.4, GB), "99p");
  assert.equal(money(9.96, GB), "10p");
  assert.equal(money(0.4, GB), "0.4p");
  assert.equal(money(-150, GB), "−£1.50");
  assert.equal(money(-3, US), "−3¢");
  assert.equal(money(250, US), "$2.50");
  assert.equal(money(9, EU), "9 ct");
  assert.equal(money(-105, EU), "−€1.05");
});

test("moneySpoken: pence and pounds, credits said as 'back', rounding to whole units", () => {
  assert.equal(moneySpoken(100, GB), "£1");
  assert.equal(moneySpoken(99.6, GB), "£1");
  assert.equal(moneySpoken(150.5, GB), "£1.51");
  assert.equal(moneySpoken(105, GB), "£1.05");
  assert.equal(moneySpoken(-150, GB), "£1.50 back");
  assert.equal(moneySpoken(-3, GB), "3 pence back");
  assert.equal(moneySpoken(1, US), "1 cent");
  assert.equal(moneySpoken(100, US), "$1.00");
  assert.equal(moneySpoken(2, EU), "2 cents");
  assert.equal(moneySpoken(310, EU), "€3.10");
});

test(
  "formatting carries rounding into the next unit",
  () => {
    assert.equal(money(99.6, GB), "£1.00");
    assert.equal(money(99.6, US), "$1.00");
    assert.equal(money(-0.004, GB), "0p");
    assert.equal(duration(119.5), "2 h");
    assert.equal(grams(999.6), "1.0 kg");
  },
);

test("rate and duration read naturally", () => {
  assert.equal(rate(-2.04, GB), "−2.0p/kWh");
  assert.equal(rate(3.66, US), "3.7¢/kWh");
  assert.equal(rate(12, EU), "12.0 ct/kWh");
  assert.equal(duration(0), "0 min");
  assert.equal(duration(45), "45 min");
  assert.equal(duration(60), "1 h");
  assert.equal(duration(150), "2 h 30");
  assert.equal(duration(825), "13 h 45");
  assert.equal(grams(320.4), "320 g");
  assert.equal(grams(1400), "1.4 kg");
});

/* ------------------------------------------------------------------ appliances */

test("findAppliance: ids, names and everyday aliases", () => {
  const cases: [string, string | null][] = [
    ["washer dryer", "tumble-dryer"],
    ["washer", "washing-machine"],
    ["Tumble Dryer", "tumble-dryer"],
    ["the drying", "tumble-dryer"],
    ["  DISHWASHER  ", "dishwasher"],
    ["dish washer", "dishwasher"],
    ["hot-water", "hot-water"],
    ["boiler", "hot-water"],
    ["EV", "ev"],
    ["electric vehicle", "ev"],
    ["Powerwall", "battery"],
    ["laundry", "washing-machine"],
    ["kettle", null],
    ["heat pump", null],
    ["this evening", null], // \bev\b doesn't fire inside words
  ];
  for (const [said, id] of cases) assert.equal(findAppliance(said)?.id ?? null, id, said);
  // Every catalogue entry is found by its own id and name.
  for (const a of APPLIANCES) {
    assert.equal(findAppliance(a.id)?.id, a.id);
    assert.equal(findAppliance(a.name)?.id, a.id);
  }
});

test(
  "findAppliance doesn't hear 'car' inside other words",
  () => {
    for (const w of ["carbon", "card", "scared", "decarbonise"]) assert.equal(findAppliance(w), null, w);
  },
);

/* ------------------------------------------------------------------ phrase router */

const user = (text: string): Message => ({ role: "user", content: [{ text }] });
const toolOf = (t: ReturnType<typeof fallbackTurn>) => {
  const b = t.message.content[0];
  return "toolUse" in b ? b.toolUse : null;
};
const route = (said: string, history: Message[] = []) => toolOf(fallbackTurn([...history, user(said)]));
const offered = (id: string, appliance: string, start: string): Message[] => [
  user(`when should I run the ${appliance}`),
  { role: "assistant", content: [{ toolUse: { toolUseId: id, name: "plan_appliance", input: { appliance } } }] },
  {
    role: "user",
    content: [{ toolResult: { toolUseId: id, content: [{ text: "Run it at 1 a.m." }, { text: `For schedule_run, pass start "${start}". Don't read this line aloud.` }] } }],
  },
  { role: "assistant", content: [{ text: "Run it at 1 a.m. Want me to set a reminder?" }] },
];

test("router: 'yes' with nothing offered gets the help sentence, never schedule_run", () => {
  for (const said of ["yes", "ok", "do it", "sounds good"]) {
    const t = fallbackTurn([user(said)]);
    assert.equal(t.stop, "end_turn", said);
    assert.equal(toolOf(t), null, said);
  }
});

test("router: 'yes' after two offers schedules the most recent one", () => {
  const history = [...offered("p1", "dishwasher", "2026-10-05T00:00:00.000Z"), ...offered("p2", "car", "2026-10-05T02:30:00.000Z")];
  assert.deepEqual(route("yes please", history), {
    toolUseId: route("yes please", history)!.toolUseId,
    name: "schedule_run",
    input: { appliance: "car", start: "2026-10-05T02:30:00.000Z" },
  });
});

test(
  "router: refusals after an offer never schedule the run",
  () => {
    const history = offered("p1", "dishwasher", "2026-10-05T00:00:00.000Z");
    for (const said of ["no, don't do it", "okay, forget it", "yes, cancel the dishwasher"]) {
      assert.notEqual(route(said, history)?.name, "schedule_run", said);
    }
  },
);

test("router: cancel, savings and planned-runs phrasings", () => {
  assert.deepEqual(route("cancel the car charge")?.input, { appliance: "car" });
  assert.equal(route("forget the washing")?.name, "cancel_run");
  // Ambiguous, documented: "don't run X now" is read as cancelling X's planned run.
  assert.deepEqual(route("don't run the dishwasher now")?.input, { appliance: "dishwasher" });
  assert.equal(route("don't run the dishwasher now")?.name, "cancel_run");
  assert.equal(route("cancel it"), null); // no appliance: help sentence
  assert.equal(route("how much have I saved this week")?.name, "get_savings");
  assert.equal(route("what are my savings")?.name, "get_savings");
  assert.equal(route("what's coming up tonight")?.name, "list_runs");
  assert.equal(route("any reminders")?.name, "list_runs");
});

test("router: 'is now a good time' beats the appliance; 'when should I' plans", () => {
  assert.equal(route("is now a good time to run the dishwasher")?.name, "check_now");
  assert.equal(route("should I run the dishwasher right now")?.name, "check_now");
  assert.equal(route("is it cheap at the moment")?.name, "check_now");
  assert.equal(route("when should I run the dishwasher")?.name, "plan_appliance");
  assert.equal(route("when is power cheapest tomorrow")?.name, "get_tide");
});

test("router: kWh is captured for the car only, with deadlines and goals", () => {
  assert.deepEqual(route("charge the car with 40 kwh by 7am")?.input, { appliance: "car", finish_by: "7am", kwh: 40 });
  assert.deepEqual(route("top up the tesla 25 kilowatt hours, greenest")?.input, { appliance: "car", goal: "greenest", kwh: 25 });
  assert.deepEqual(route("run the dishwasher 2 kwh")?.input, { appliance: "dishwasher" });
  const window = route("dishwasher after 22:00 until midnight")!.input;
  assert.equal(window.finish_by, "midnight");
  assert.equal(String(window.start_after).trim(), "22:00"); // captured with a trailing space; nextClockTime trims it
});

test(
  "router: decimals in kWh and times survive",
  () => {
    assert.equal(route("charge the car with 7.5 kwh")?.input.kwh, 7.5);
    assert.notEqual(route("charge the car with 1000 kwh")?.input.kwh, 0);
    assert.equal(route("run the dishwasher by 7.30am")?.input.finish_by, "7.30am");
  },
);

test(
  "router: questions about carbon don't plan a car charge",
  () => {
    assert.notEqual(route("when is carbon lowest tonight")?.name, "plan_appliance");
  },
);

test("router: off-topic requests get the help sentence", () => {
  for (const said of ["play some jazz", "what's the weather", "tell me a joke", ""]) {
    const t = fallbackTurn([user(said)]);
    assert.equal(t.stop, "end_turn", said);
    assert.equal(t.engine, "fallback");
    const b = t.message.content[0];
    assert.ok("text" in b && /electricity is cheapest/.test(b.text), said);
  }
});

test("router: tool results are spoken; errors don't offer a reminder; empty results say 'Done.'", () => {
  const use = (id: string, name: string): Message => ({ role: "assistant", content: [{ toolUse: { toolUseId: id, name, input: { appliance: "car" } } }] });
  const errored = fallbackTurn([
    user("car"),
    use("e1", "plan_appliance"),
    { role: "user", content: [{ toolResult: { toolUseId: "e1", status: "error", content: [{ text: "Prices aren't published far enough ahead." }] } }] },
  ]);
  const b = errored.message.content[0];
  assert.ok("text" in b && b.text === "Prices aren't published far enough ahead.");
  const empty = fallbackTurn([user("list"), use("e2", "list_runs"), { role: "user", content: [{ toolResult: { toolUseId: "e2", content: [] } }] }]);
  const e = empty.message.content[0];
  assert.ok("text" in e && e.text === "Done.");
});

/* ------------------------------------------------------------------ MCP tools and routes, in-process */

type Handler = { cfg: { inputSchema?: { parse: (x: unknown) => Record<string, unknown> } }; fn: (args: Record<string, unknown>, extra?: unknown) => Promise<unknown> };
type ToolOut = { content: { type: string; text: string }[]; structuredContent: { facts: { label: string; value: string }[]; headline: string } };

function toolsFor(homeId: string | null): Map<string, Handler> {
  const tools = new Map<string, Handler>();
  const fake = {
    registerTool: (name: string, cfg: Handler["cfg"], fn: Handler["fn"]) => void tools.set(name, { cfg, fn }),
    registerResource: () => undefined,
  };
  registerLowtide(fake as never, { homeId });
  return tools;
}
/** Validates the arguments with the tool's own zod schema (as the MCP server does), then runs it. */
async function call(tools: Map<string, Handler>, name: string, args: Record<string, unknown> = {}): Promise<ToolOut> {
  const t = tools.get(name);
  if (!t) throw new Error(`no tool ${name}`);
  const parsed = t.cfg.inputSchema ? t.cfg.inputSchema.parse(args) : args;
  return (await t.fn(parsed, {})) as ToolOut;
}
async function callError(tools: Map<string, Handler>, name: string, args: Record<string, unknown> = {}): Promise<string> {
  try {
    await call(tools, name, args);
    return "";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

test("tools: zod limits reject out-of-range input before any work is done", async () => {
  const guest = toolsFor(null);
  const bad: [string, Record<string, unknown>][] = [
    ["plan_appliance", { appliance: "d" }],
    ["plan_appliance", { appliance: "x".repeat(41) }],
    ["plan_appliance", { appliance: "dishwasher", kwh: 0 }],
    ["plan_appliance", { appliance: "dishwasher", kwh: 100.5 }],
    ["plan_appliance", { appliance: "dishwasher", minutes: 14 }],
    ["plan_appliance", { appliance: "dishwasher", minutes: 721 }],
    ["plan_appliance", { appliance: "dishwasher", minutes: 90.5 }],
    ["plan_appliance", { appliance: "dishwasher", goal: "fastest" }],
    ["plan_appliance", { appliance: "dishwasher", finish_by: "x".repeat(31) }],
    ["plan_appliance", { appliance: "dishwasher", place: "x".repeat(41) }],
    ["get_tide", { place: "x" }],
    ["schedule_run", { appliance: "dishwasher", start: "x".repeat(41) }],
    ["set_home", { place: "SW1A", name: "x".repeat(41) }],
  ];
  for (const [name, args] of bad) assert.notEqual(await callError(guest, name, args), "", `${name} ${JSON.stringify(args)}`);
  assert.equal(guest.size, 8);
});

test("tools: the guest endpoint answers price questions for a named place and refuses anything stateful", async () => {
  const guest = toolsFor(null);
  for (const name of ["schedule_run", "list_runs", "cancel_run", "get_savings", "set_home"]) {
    const args = name === "schedule_run" ? { appliance: "dishwasher", start: "01:00" } : name === "cancel_run" ? { appliance: "car" } : name === "set_home" ? { place: "Berlin" } : {};
    assert.match(await callError(guest, name, args), /own Lowtide link/, name);
  }
  assert.match(await callError(guest, "get_tide"), /Which postcode or city/);
  assert.match(await callError(guest, "get_tide", { place: "Paris" }), /couldn't place "Paris"/);
  const r = await call(guest, "get_tide", { place: "Berlin" });
  assert.match(r.content[0].text, /^Electricity in Germany is cheapest/);
});

test("tools: an EV top-up's run time scales with the energy at 7.4 kW, in 15-minute steps", async () => {
  const guest = toolsFor(null);
  const load = async (args: Record<string, unknown>) =>
    (await call(guest, "plan_appliance", { appliance: "car", place: "Berlin", ...args })).structuredContent.facts.find((f) => f.label === "Load")!.value;
  assert.equal(await load({ kwh: 20 }), "20 kWh over 2 h 45"); // 162 min -> 165
  assert.equal(await load({ kwh: 60 }), "60 kWh over 8 h 15"); // 486.5 min -> 495, beyond the 720-minute input cap's spirit but allowed
  assert.equal(await load({}), "30 kWh over 4 h 05"); // catalogue default
  assert.equal(await load({ kwh: 20, minutes: 60 }), "20 kWh over 1 h"); // explicit minutes win
  // A non-EV load keeps its own run time whatever the energy.
  const dish = await call(guest, "plan_appliance", { appliance: "dishwasher", place: "Berlin", kwh: 2 });
  assert.equal(dish.structuredContent.facts.find((f) => f.label === "Load")!.value, "2 kWh over 3 h");
});

test("tools: plan_appliance hands schedule_run an exact ISO start on a separate, unspoken line", async () => {
  const guest = toolsFor(null);
  const r = await call(guest, "plan_appliance", { appliance: "dishwasher", place: "Berlin", goal: "balanced" });
  assert.equal(r.content.length, 2);
  const iso = r.content[1].text.match(/pass start "([^"]+)"/)?.[1];
  assert.ok(iso && Number.isFinite(Date.parse(iso)));
  assert.ok(!/pass start/.test(r.content[0].text));
  // Hours 5 and 6 are the 2 ct trough, so a three-hour dishwasher run starts at hour 4 or 5.
  assert.ok([BASE + 4 * HOUR, BASE + 5 * HOUR].includes(Date.parse(iso!)), iso);
});

test("tools: check_now says plainly when the current hour has no price", async () => {
  assert.match(await callError(toolsFor(null), "check_now", { place: "Chicago" }), /no published price for this half hour/);
});

test("store: household ids are 10 base32 characters, and a well-formed unknown id fails on first use, not at connect", async () => {
  const ids = new Set(Array.from({ length: 200 }, () => newHomeId()));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, HOME_ID);
  assert.ok(!HOME_ID.test("ABCDEFGHIJ") && !HOME_ID.test("abcdefghi1") && !HOME_ID.test("abcdefghijk"));
  // The MCP endpoint only checks the id's shape, so a client "connects" and lists all eight tools
  // for a household that doesn't exist (the Echo's "household gone" recovery never triggers).
  const ghost = toolsFor(newHomeId());
  assert.equal(ghost.size, 8);
  assert.match(await callError(ghost, "get_tide"), /doesn't match a household/);
});

test("household: schedule, list, cancel round-trip through the store", async () => {
  const home = await createHome("Berlin", "DE");
  const tools = toolsFor(home.home.id);
  const plan = await call(tools, "plan_appliance", { appliance: "washing machine" });
  const start = plan.content[1].text.match(/pass start "([^"]+)"/)![1];
  const saved = await call(tools, "schedule_run", { appliance: "washing machine", start });
  assert.match(saved.content[0].text, /^Saved\. Start the washing machine/);
  assert.match((await call(tools, "list_runs")).content[0].text, /one run planned: the washing machine/);
  assert.equal((await call(tools, "cancel_run", { appliance: "washer" })).content[0].text, "Okay, I've cancelled the washing machine.");
  assert.equal((await call(tools, "cancel_run", { appliance: "washer" })).content[0].text, "There wasn't a washing machine run planned.");
  const state = await loadHome(home.home.id);
  assert.deepEqual(state!.runs.map((r) => r.status), ["cancelled"]);
});

test(
  "household: schedule_run refuses a start time that has already passed",
  async () => {
    const home = await createHome("Berlin", "DE");
    const tools = toolsFor(home.home.id);
    await call(tools, "get_tide"); // primes BASE
    const twoHoursAgo = new Date(BASE - 2 * HOUR).toISOString();
    const err = await callError(tools, "schedule_run", { appliance: "dishwasher", start: twoHoursAgo });
    const savings = (await call(tools, "get_savings")).content[0].text;
    assert.notEqual(err, "", `saved a past run; get_savings now says: ${savings}`);
  },
);

/* ---- /api/homes ---- */

const post = (body: unknown, ip = "203.0.113.7") =>
  homes.POST(new Request("http://localhost:3000/api/homes", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) }));

test("/api/homes: makes a household with a working MCP link, and refuses places it can't price", async () => {
  const r = await post({ place: "Berlin" }, "198.51.100.1");
  assert.equal(r.status, 200);
  const j = (await r.json()) as { id: string; mcpUrl: string; region: string };
  assert.match(j.id, HOME_ID);
  assert.equal(j.mcpUrl, `http://localhost:3000/api/mcp/h/${j.id}`);
  assert.equal(j.region, "Germany");
  assert.equal((await post({ place: "Paris" }, "198.51.100.1")).status, 400);
  assert.equal((await post({}, "198.51.100.1")).status, 400);
});

test("/api/homes: 20 households per IP per hour, then 429 (failed attempts count too)", async () => {
  const ip = "192.0.2.50";
  for (let i = 0; i < 20; i++) assert.equal((await post({ place: "x" }, ip)).status, 400); // too short, but counted
  assert.equal((await post({ place: "Berlin" }, ip)).status, 429);
  assert.equal((await post({ place: "Berlin" }, "192.0.2.51")).status, 200); // a different address is a fresh allowance
});

test(
  "/api/homes: a flood of distinct addresses doesn't reset everyone else's limit",
  async () => {
    const ip = "192.0.2.60";
    for (let i = 0; i < 20; i++) await post({ place: "x" }, ip);
    assert.equal((await post({ place: "x" }, ip)).status, 429);
    for (let i = 0; i < 5001; i++) await post({ place: "x" }, `2001:db8::${i.toString(16)}`);
    assert.equal((await post({ place: "x" }, ip)).status, 429);
  },
);

test(
  "/api/homes: the household name is stored only as a short string",
  async () => {
    const big = await post({ place: "Berlin", name: ["x".repeat(50_000)] }, "198.51.100.9");
    assert.equal(big.status, 200);
    const { id } = (await big.json()) as { id: string };
    const stored = (await loadHome(id))!.home.name as unknown;
    assert.ok(stored === undefined || (typeof stored === "string" && stored.length <= 40), `stored ${(JSON.stringify(stored) ?? "").length} bytes`);
    const obj = await post({ place: "Berlin", name: { a: 1 } }, "198.51.100.9");
    const j = (await obj.json()) as { error?: string };
    assert.doesNotMatch(j.error ?? "", /is not a function/);
  },
);

/* ---- /api/alexa (no Bedrock key: the phrase router answers) ---- */

const turn = (body: unknown) =>
  alexa.POST(
    new Request("http://localhost:3000/api/alexa", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000", host: "localhost:3000" },
      body: JSON.stringify(body),
    }),
  );

test("/api/alexa: without a model key the phrase router picks the tool; bad requests are 400/413", async () => {
  const r = await turn({ messages: [user("when should I run the dishwasher")], tools: [] });
  assert.equal(r.status, 200);
  const j = (await r.json()) as { engine: string; stop: string; message: Message };
  assert.equal(j.engine, "fallback");
  assert.equal(j.stop, "tool_use");
  assert.equal((await turn({ messages: [] })).status, 400);
  assert.equal((await turn({ messages: [{ role: "assistant", content: [{ text: "hi" }] }] })).status, 400);
  assert.equal((await turn({ messages: [user("x".repeat(70_000))] })).status, 413);
});

test(
  "/api/alexa: a malformed message is a 400, not an unhandled exception",
  async () => {
    let status = 0;
    try {
      status = (await turn({ messages: [{ role: "user", content: "hi" }] })).status;
    } catch (e) {
      assert.fail(`threw ${e}`);
    }
    assert.equal(status, 400);
  },
);
