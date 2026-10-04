import "server-only";
import type { Slot } from "./grid/types";
import { agileRates, carbonForecast, regionLetter, UK_REGIONS } from "./grid/uk";
import { offsetMs, zonedToUtc } from "./grid/time";
import { APPLIANCES } from "./appliances";
import { planRun } from "./plan";
import type { ScheduledRun } from "./store";

const TZ = "Europe/London";
const DAY = 86400_000;

/** Wall-clock time `daysAgo` days back, at hh:mm London time. */
function at(daysAgo: number, hh: number, mm: number, now: number): number {
  const local = new Date(now - daysAgo * DAY + offsetMs(now - daysAgo * DAY, TZ));
  return zonedToUtc(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hh, mm, TZ);
}

/**
 * Two weeks of plausible household runs for a demo home in Britain, each one planned exactly as Lowtide
 * would have planned it that evening, priced with the Agile rates (and carbon) that were really published
 * for those nights. Nothing is invented except the household's habits.
 */
export async function seedHistory(postcode: string, now = Date.now()): Promise<ScheduledRun[]> {
  const letter = await regionLetter(postcode);
  const from = now - 15 * DAY;
  const [rates, carbon] = await Promise.all([
    agileRates(letter, from, now),
    carbonForecast(UK_REGIONS[letter].carbonId, from, now).catch(() => []),
  ]);
  const co2 = new Map(carbon.map((c) => [Date.parse(c.from.replace(/Z?$/, "Z")), c.intensity.actual ?? c.intensity.forecast]));
  const slots: Slot[] = rates.map((r) => ({ ...r, carbon: co2.get(r.start) ?? null }));
  if (slots.length < 48) return [];

  const habits: { daysAgo: number; appliance: string; asked: [number, number]; finish: [number, number]; nextDay: boolean; kwh?: number }[] = [];
  for (let d = 14; d >= 1; d--) {
    if (d % 7 !== 4) habits.push({ daysAgo: d, appliance: "dishwasher", asked: [19, 30], finish: [7, 0], nextDay: true });
    if ([2, 5, 9, 12].includes(d)) habits.push({ daysAgo: d, appliance: "washing-machine", asked: [8, 0], finish: [18, 0], nextDay: false });
    if ([3, 10].includes(d)) habits.push({ daysAgo: d, appliance: "ev", asked: [18, 30], finish: [7, 30], nextDay: true, kwh: 25 });
  }

  const runs: ScheduledRun[] = [];
  for (const h of habits) {
    const app = APPLIANCES.find((a) => a.id === h.appliance)!;
    const asked = at(h.daysAgo, h.asked[0], h.asked[1], now);
    const finishBy = at(h.nextDay ? h.daysAgo - 1 : h.daysAgo, h.finish[0], h.finish[1], now);
    if (finishBy > now) continue;
    const kwh = h.kwh ?? app.kwh;
    const minutes = h.kwh ? Math.ceil(((h.kwh / 7.4) * 60) / 15) * 15 : app.minutes;
    try {
      const plan = planRun(slots, { kwh, minutes, now: asked, finishBy });
      runs.push({
        id: `seed${runs.length}`,
        appliance: app.id,
        label: app.name,
        start: plan.best.start,
        end: plan.best.end,
        kwh,
        cost: plan.best.cost,
        costIfNow: plan.now?.cost ?? null,
        carbon: plan.best.carbon,
        carbonIfNow: plan.now?.carbon ?? null,
        createdAt: asked,
        status: "planned",
      });
    } catch {
      /* a night with a gap in the published prices: skip it */
    }
  }
  return runs;
}
