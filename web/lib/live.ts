import "server-only";
import { getTide, type Tide } from "./grid";
import { ukTable, UK_REGIONS } from "./grid/uk";
import { tideMarks, planRun, costRun, type Run } from "./plan";
import { APPLIANCES } from "./appliances";
/** A day's prices for a dial or chart. */
export interface ChartData {
  slots: { s: number; e: number; p: number; c: number | null }[];
  now: number;
  marks: { low: { start: number; end: number; avgPrice: number } | null; high: { start: number; end: number; avgPrice: number } | null };
  berths: { start: number; end: number; label: string; state: "best" | "now" | "planned" | "done" | "alt" }[];
  unit: "p" | "¢" | "ct";
  timeZone: string;
}
import { offsetMs, zonedToUtc } from "./grid/time";

export const DEMO_PLACE = "SE1 7PB";

export function chartOf(tide: Tide, hours = 24, berths: ChartData["berths"] = []): ChartData {
  const now = Date.now();
  const end = now + hours * 3600_000;
  const slots = tide.slots.filter((s) => s.start < end);
  return {
    slots: slots.map((s) => ({ s: s.start, e: s.end, p: s.price, c: s.carbon })),
    now,
    marks: tideMarks(slots, 60),
    berths,
    unit: tide.region.unit,
    timeZone: tide.region.timeZone,
  };
}

/** Everything the home page shows, from live feeds. Each part degrades to null on its own. */
export async function homeData() {
  const london = await getTide(DEMO_PLACE).catch(() => null);
  if (!london) return { london: null } as const;
  const now = Date.now();
  const day = london.slots.filter((s) => s.start < now + 24 * 3600_000);
  const { low, high } = tideMarks(day, 60);
  const cur = day.find((s) => s.start <= now && now < s.end) ?? null;

  const dish = APPLIANCES.find((a) => a.id === "dishwasher")!;
  let plan: ReturnType<typeof planRun> | null = null;
  try {
    plan = planRun(london.slots, { kwh: dish.kwh, minutes: dish.minutes, now, finishBy: undefined });
  } catch {}

  // What each appliance costs at today's low and high water.
  const spread = APPLIANCES.filter((a) => a.id !== "battery").map((a) => {
    const runs = day
      .map((s) => costRun(day, s.start, a.minutes, a.kwh))
      .filter((r): r is Run => r !== null)
      .sort((x, y) => x.cost - y.cost);
    return { appliance: a, low: runs[0] ?? null, high: runs[runs.length - 1] ?? null };
  });

  return { london, low, high, cur, plan, spread, chart: chartOf(london, 24, plan ? [{ start: plan.best.start, end: plan.best.end, label: "dishwasher", state: "best" as const }] : []) } as const;
}

type ChartRunLike = { start: number; end: number; avgPrice: number };

export interface SceneRun {
  id: "dishwasher" | "washing-machine" | "ev" | "hot-water";
  label: string;
  start: number;
  end: number;
  cost: number; // minor units at low tide
  costAtSix: number; // minor units had it started at 18:00 (or now, if later)
}
export interface SceneData {
  place: string;
  region: string;
  tariff: string;
  timeZone: string;
  unit: Tide["region"]["unit"];
  currency: Tide["region"]["currency"];
  now: number;
  /** True when "six in the evening" has already passed and the comparison is with starting now. */
  eveningIsNow: boolean;
  slots: { s: number; e: number; p: number; c: number | null }[];
  runs: SceneRun[];
}

/**
 * Tonight in one household: each appliance planned by Lowtide to finish by the morning, from the live
 * prices, compared with switching everything on at six in the evening.
 */
export function sceneOf(tide: Tide): SceneData {
  const now = Date.now();
  const tz = tide.region.timeZone;
  const horizon = now + 24 * 3600_000;
  const morning = (hh: number, mm: number) => {
    // The next hh:mm local time at least 6 hours away, so "by morning" means tomorrow morning.
    let t = zonedNext(hh, mm, tz, now);
    if (t - now < 6 * 3600_000) t += 24 * 3600_000;
    return Math.min(t, tide.slots[tide.slots.length - 1].end);
  };
  const habits: { id: SceneRun["id"]; finish: [number, number]; kwh?: number; minutes?: number }[] = [
    { id: "dishwasher", finish: [7, 0] },
    { id: "washing-machine", finish: [7, 0] },
    { id: "hot-water", finish: [6, 30] },
    { id: "ev", finish: [7, 30], kwh: 22, minutes: 180 },
  ];
  const evening = Math.max(now, zonedNext(18, 0, tz, now - 12 * 3600_000));
  const runs: SceneRun[] = [];
  for (const h of habits) {
    const a = APPLIANCES.find((x) => x.id === h.id)!;
    const kwh = h.kwh ?? a.kwh;
    const minutes = h.minutes ?? a.minutes;
    try {
      const plan = planRun(tide.slots, { kwh, minutes, now, finishBy: morning(h.finish[0], h.finish[1]) });
      const six = costRun(tide.slots, evening, minutes, kwh) ?? plan.now ?? plan.priciest;
      runs.push({ id: h.id, label: a.name, start: plan.best.start, end: plan.best.end, cost: plan.best.cost, costAtSix: six.cost });
    } catch {
      /* not enough published prices yet for this one */
    }
  }
  return {
    place: tide.region.place,
    region: tide.region.name,
    tariff: tide.region.tariff,
    timeZone: tz,
    unit: tide.region.unit,
    currency: tide.region.currency,
    now,
    eveningIsNow: evening === now,
    slots: tide.slots.filter((s) => s.end > now - 3600_000 && s.start < horizon + 3600_000).map((s) => ({ s: s.start, e: s.end, p: s.price, c: s.carbon })),
    runs,
  };
}

/** The next local hh:mm at or after `from`. */
function zonedNext(hh: number, mm: number, tz: string, from: number): number {
  const local = new Date(from + offsetMs(from, tz));
  let t = zonedToUtc(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hh, mm, tz);
  if (t < from) t = zonedToUtc(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1, hh, mm, tz);
  return t;
}

/** Scenes for the home page's place switcher (Britain by Agile region, plus Chicago and Berlin). */
export const SCENE_PLACES: { key: string; label: string; place: string }[] = [
  { key: "london", label: "London", place: "SE1 7PB" },
  { key: "manchester", label: "Manchester", place: "M1 1AE" },
  { key: "glasgow", label: "Glasgow", place: "G1 1XQ" },
  { key: "cardiff", label: "Cardiff", place: "CF10 1EP" },
  { key: "chicago", label: "Chicago", place: "Chicago" },
  { key: "berlin", label: "Berlin", place: "Berlin" },
];

export async function scenes(): Promise<{ key: string; label: string; scene: SceneData }[]> {
  const out = await Promise.all(
    SCENE_PLACES.map(async (p) => {
      const tide = await getTide(p.place).catch(() => null);
      return tide ? { key: p.key, label: p.label, scene: sceneOf(tide) } : null;
    }),
  );
  return out.filter((x): x is NonNullable<typeof x> => x !== null && x.scene.slots.length > 4);
}

export interface TableRow {
  key: string;
  name: string;
  tariff: string;
  unit: Tide["region"]["unit"];
  timeZone: string;
  low: ChartRunLike | null;
  high: ChartRunLike | null;
  now: number | null;
  chart: ChartData | null;
}

/** Low and high water for every region Lowtide covers. */
export async function tableData(): Promise<TableRow[]> {
  const now = Date.now();
  const [uk, us, de] = await Promise.all([
    ukTable().catch(() => []),
    getTide("Chicago").catch(() => null),
    getTide("Germany").catch(() => null),
  ]);
  const rows: TableRow[] = uk.map((r) => {
    const day = r.slots.filter((s) => s.start < now + 24 * 3600_000);
    const { low, high } = tideMarks(day, 60);
    return {
      key: `GB-${r.letter}`,
      name: r.name,
      tariff: "Octopus Agile",
      unit: "p",
      timeZone: "Europe/London",
      low,
      high,
      now: day.find((s) => s.start <= now && now < s.end)?.price ?? null,
      chart: day.length
        ? { slots: day.map((s) => ({ s: s.start, e: s.end, p: s.price, c: null })), now, marks: { low, high }, berths: [], unit: "p", timeZone: "Europe/London" }
        : null,
    };
  });
  rows.sort((a, b) => Object.keys(UK_REGIONS).indexOf(a.key.slice(3)) - Object.keys(UK_REGIONS).indexOf(b.key.slice(3)));
  for (const t of [us, de]) {
    if (!t) continue;
    const c = chartOf(t, 24);
    const day = t.slots.filter((s) => s.start < now + 24 * 3600_000);
    rows.push({
      key: t.region.id,
      name: t.region.name,
      tariff: t.region.tariff,
      unit: t.region.unit,
      timeZone: t.region.timeZone,
      low: c.marks.low,
      high: c.marks.high,
      now: day.find((s) => s.start <= now && now < s.end)?.price ?? null,
      chart: { ...c, slots: c.slots.map((s) => ({ ...s, c: null })) },
    });
  }
  return rows;
}
