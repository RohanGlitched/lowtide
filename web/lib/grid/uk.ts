import type { FuelShare, Region, Slot, Tide } from "./types";
import { getJson, HALF_HOUR } from "./http";

const OCTOPUS = "https://api.octopus.energy/v1";
const CARBON = "https://api.carbonintensity.org.uk";

/** Octopus/DNO region letters, with the matching National Grid ESO carbon region id. */
export const UK_REGIONS: Record<string, { name: string; carbonId: number }> = {
  A: { name: "East England", carbonId: 10 },
  B: { name: "East Midlands", carbonId: 9 },
  C: { name: "London", carbonId: 13 },
  D: { name: "Merseyside and North Wales", carbonId: 6 },
  E: { name: "West Midlands", carbonId: 8 },
  F: { name: "North East England", carbonId: 4 },
  G: { name: "North West England", carbonId: 3 },
  H: { name: "Southern England", carbonId: 12 },
  J: { name: "South East England", carbonId: 14 },
  K: { name: "South Wales", carbonId: 7 },
  L: { name: "South West England", carbonId: 11 },
  M: { name: "Yorkshire", carbonId: 5 },
  N: { name: "South Scotland", carbonId: 2 },
  P: { name: "North Scotland", carbonId: 1 },
};

const POSTCODE = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})?$/;

/** "sw1a 1aa" -> { outward: "SW1A", full: "SW1A1AA" }; null when it isn't a UK postcode. */
export function parsePostcode(input: string): { outward: string; full: string } | null {
  const m = input.trim().toUpperCase().replace(/\s+/g, " ").match(POSTCODE);
  if (!m) return null;
  return { outward: m[1], full: m[1] + (m[2] ?? "") };
}

/** The Octopus region letter for a postcode (a full postcode is most reliable; an outward code usually works). */
export async function regionLetter(postcode: string): Promise<string> {
  const pc = parsePostcode(postcode);
  if (!pc) throw new Error(`"${postcode}" doesn't look like a UK postcode.`);
  const tries = pc.full !== pc.outward ? [pc.full, pc.outward] : [pc.outward, pc.outward + "1AA"];
  for (const q of tries) {
    const r = await getJson<{ results: { group_id: string }[] }>(
      `${OCTOPUS}/industry/grid-supply-points/?postcode=${encodeURIComponent(q)}`,
      86400,
    ).catch(() => null);
    const g = r?.results?.[0]?.group_id;
    if (g) return g.replace("_", "");
  }
  throw new Error(`Couldn't find the electricity region for ${pc.outward}. Try the full postcode.`);
}

let agileCode: { code: string; at: number } | null = null;

/** The current Agile import product (Octopus versions it, e.g. AGILE-24-10-01). */
async function agileProduct(): Promise<string> {
  if (agileCode && Date.now() - agileCode.at < 6 * 3600_000) return agileCode.code;
  const r = await getJson<{ results: { code: string; direction: string; brand: string }[] }>(
    `${OCTOPUS}/products/?is_variable=true&brand=OCTOPUS_ENERGY&page_size=100`,
    3600,
  );
  const agile = r.results
    .filter((p) => /^AGILE-\d{2}-\d{2}-\d{2}$/.test(p.code) && p.direction === "IMPORT")
    .map((p) => p.code)
    .sort()
    .pop();
  if (!agile) throw new Error("Octopus isn't listing an Agile tariff right now.");
  agileCode = { code: agile, at: Date.now() };
  return agile;
}

interface Rate {
  value_inc_vat: number;
  valid_from: string;
  valid_to: string;
}

export async function agileRates(letter: string, from: number, to?: number): Promise<{ start: number; end: number; price: number }[]> {
  const product = await agileProduct();
  const tariff = `E-1R-${product}-${letter}`;
  const r = await getJson<{ results: Rate[] }>(
    `${OCTOPUS}/products/${product}/electricity-tariffs/${tariff}/standard-unit-rates/?period_from=${new Date(from).toISOString()}${to ? `&period_to=${new Date(to).toISOString()}` : ""}&page_size=1500`,
    to ? 3600 : 300,
  );
  return r.results
    .map((x) => ({ start: Date.parse(x.valid_from), end: Date.parse(x.valid_to), price: round2(x.value_inc_vat) }))
    .sort((a, b) => a.start - b.start);
}

interface CarbonPoint {
  from: string;
  to: string;
  intensity: { forecast: number; actual?: number | null };
  generationmix?: FuelShare[];
}

export async function carbonForecast(carbonId: number, from: number, to?: number): Promise<CarbonPoint[]> {
  const iso = (t: number) => new Date(t).toISOString().slice(0, 16) + "Z";
  const r = await getJson<{ data: { data: CarbonPoint[] } | { data: CarbonPoint[] }[] }>(
    `${CARBON}/regional/intensity/${iso(from)}/${to ? iso(to) : "fw48h"}/regionid/${carbonId}`,
    to ? 3600 : 600,
  );
  const d = Array.isArray(r.data) ? r.data[0] : r.data;
  return d?.data ?? [];
}

export async function ukTide(place: string, letterHint?: string): Promise<Tide> {
  const letter = letterHint ?? (await regionLetter(place));
  const info = UK_REGIONS[letter];
  if (!info) throw new Error(`Unknown British electricity region ${letter}.`);
  const from = Math.floor(Date.now() / HALF_HOUR) * HALF_HOUR;
  const [rates, carbon] = await Promise.all([
    agileRates(letter, from),
    carbonForecast(info.carbonId, from).catch(() => [] as CarbonPoint[]),
  ]);
  const byStart = new Map(carbon.map((c) => [Date.parse(c.from.replace(/Z?$/, "Z")), c.intensity.forecast]));
  const slots: Slot[] = rates.map((r) => ({ ...r, carbon: byStart.get(r.start) ?? null }));
  const nowMix = carbon[0]?.generationmix ?? null;
  const region: Region = {
    country: "GB",
    id: `GB-${letter}`,
    name: info.name,
    place: parsePostcode(place)?.outward ?? place,
    timeZone: "Europe/London",
    currency: "GBP",
    unit: "p",
    tariff: "Octopus Agile",
    priceNote: "Agile unit rate including VAT, published each afternoon for the next day.",
    carbonSource: "National Energy System Operator regional carbon forecast",
  };
  return {
    region,
    slots,
    mix: nowMix ? [...nowMix].sort((a, b) => b.perc - a.perc) : null,
    fetchedAt: Date.now(),
    sources: ["api.octopus.energy", "carbonintensity.org.uk"],
  };
}

/** Next low water for every British region, for the tide table on the home page. */
export async function ukTable(): Promise<{ letter: string; name: string; slots: Slot[] }[]> {
  const from = Math.floor(Date.now() / HALF_HOUR) * HALF_HOUR;
  return Promise.all(
    Object.entries(UK_REGIONS).map(async ([letter, info]) => {
      const rates = await agileRates(letter, from).catch(() => []);
      return { letter, name: info.name, slots: rates.map((r) => ({ ...r, carbon: null })) };
    }),
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;
