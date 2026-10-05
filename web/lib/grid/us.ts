import type { Region, Slot, Tide } from "./types";
import { getText, HOUR } from "./http";
import { zonedToUtc } from "./time";

const COMED = "https://hourlypricing.comed.com/rrtp/ServletFeed";
const TZ = "America/Chicago";

/** ComEd's day-ahead feed: `[[Date.UTC(2026,9,4,0,0,0), 3.6], ...]`, wall-clock Chicago hours in ¢/kWh. */
export function parseComed(text: string): { start: number; price: number }[] {
  const out: { start: number; price: number }[] = [];
  const re = /Date\.UTC\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\),\s*(-?[\d.]+)\]/g;
  for (const m of text.matchAll(re)) {
    const [y, mo, d, h] = [1, 2, 3, 4].map((i) => Number(m[i]));
    out.push({ start: zonedToUtc(y, mo, d, h, 0, TZ), price: Number(m[7]) });
  }
  out.sort((a, b) => a.start - b.start);
  // On the autumn clock change the feed lists 1 a.m. twice; the second one is the next real hour.
  for (let i = 1; i < out.length; i++) if (out[i].start <= out[i - 1].start) out[i].start = out[i - 1].start + HOUR;
  return out;
}

export async function usTide(place: string): Promise<Tide> {
  const [today, tomorrow] = await Promise.all([
    getText(`${COMED}?type=daynexttoday`, 600),
    getText(`${COMED}?type=daynexttomorrow`, 600).catch(() => "[]"),
  ]);
  const hours = [...parseComed(today), ...parseComed(tomorrow)];
  const nowHour = Math.floor(Date.now() / HOUR) * HOUR;
  const seen = new Set<number>();
  const slots: Slot[] = [];
  for (const h of hours) {
    if (h.start + HOUR <= nowHour || seen.has(h.start)) continue;
    seen.add(h.start);
    slots.push({ start: h.start, end: h.start + HOUR, price: h.price, carbon: null });
  }
  const region: Region = {
    country: "US",
    id: "US-COMED",
    name: "Northern Illinois (ComEd)",
    place,
    timeZone: TZ,
    currency: "USD",
    unit: "¢",
    tariff: "ComEd Hourly Pricing",
    priceNote: "ComEd day-ahead hourly supply price; delivery charges are added on the bill.",
    carbonSource: null,
  };
  return { region, slots, mix: null, fetchedAt: Date.now(), sources: ["hourlypricing.comed.com"] };
}
