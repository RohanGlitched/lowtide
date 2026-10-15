// What moving each load saves today, against a typical start (the average of every start in the next 24 hours)
// and against the evening peak, from live prices. Usage: npx tsx scripts/impact.ts [place]
import { getTide } from "../lib/grid";
import { planRun, typicalCost } from "../lib/plan";
import { money } from "../lib/format";
import { clock } from "../lib/grid/time";

const place = process.argv[2] ?? "SE1 7PB";
const loads = [
  { name: "dishwasher", kwh: 0.9, minutes: 180, perWeek: 7 },
  { name: "washing", kwh: 0.8, minutes: 150, perWeek: 4 },
  { name: "tumble dryer", kwh: 2.5, minutes: 120, perWeek: 3 },
  { name: "car (22 kWh)", kwh: 22, minutes: 180, perWeek: 2 },
  { name: "hot water (6 kWh)", kwh: 6, minutes: 120, perWeek: 7 },
];
const tide = await getTide(place);
const now = Date.now();
const tz = tide.region.timeZone;
console.log(`${tide.region.name}, ${tide.region.tariff}, ${new Date(now).toISOString()}, prices to ${new Date(tide.slots[tide.slots.length - 1].end).toISOString()}`);
for (const l of loads) {
  const p = planRun(tide.slots, { kwh: l.kwh, minutes: l.minutes, now, finishBy: now + 24 * 3600_000 });
  const typical = typicalCost(tide.slots, l.minutes, l.kwh, now)!;
  const perYear = Math.max(0, typical - p.best.cost) * l.perWeek * 52;
  const peakYear = Math.max(0, p.priciest.cost - p.best.cost) * l.perWeek * 52;
  console.log(
    `${l.name.padEnd(18)} best ${clock(p.best.start, tz)} ${money(p.best.cost, tide.region).padStart(7)}  typical ${money(typical, tide.region).padStart(7)}  peak ${money(p.priciest.cost, tide.region).padStart(7)}  ` +
      `kW ${(l.kwh / (l.minutes / 60)).toFixed(1)}  a year vs typical ${money(perYear, tide.region)} (vs peak ${money(peakYear, tide.region)})`,
  );
}
