import "server-only";
import { getTide, type Tide } from "./grid";
import { ukTable, UK_REGIONS } from "./grid/uk";
import { tideMarks, planRun, costRun, type Run } from "./plan";
import { APPLIANCES } from "./appliances";
import type { ChartData } from "@/views/chart";

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
