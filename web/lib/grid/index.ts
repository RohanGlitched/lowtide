import type { Country, Tide } from "./types";
import { parsePostcode, ukTide } from "./uk";
import { usTide } from "./us";
import { deTide } from "./de";

export * from "./types";

const cache = new Map<string, { at: number; tide: Promise<Tide> }>();
const FRESH_MS = 120_000;

/** Which tariff region a household is in, from what they told us. */
export function resolveCountry(place: string, country?: Country): Country {
  if (country) return country;
  const p = place.trim().toLowerCase();
  if (parsePostcode(place)) return "GB";
  if (/\b(germany|deutschland|berlin|munich|münchen|hamburg|köln|cologne|frankfurt)\b/.test(p)) return "DE";
  if (/\b(illinois|chicago|evanston|naperville|aurora|rockford|joliet|il)\b/.test(p) || /^60[0-9]{3}$/.test(p) || /^61[0-9]{3}$/.test(p)) return "US";
  throw new Error(
    `I couldn't place "${place}". Lowtide covers Britain (any postcode), northern Illinois (ComEd) and Germany.`,
  );
}

export async function getTide(place: string, country?: Country): Promise<Tide> {
  const c = resolveCountry(place, country);
  const key = c === "GB" ? `GB:${parsePostcode(place)?.outward ?? place}` : c;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.tide;
  const tide = (c === "GB" ? ukTide(place) : c === "US" ? usTide(place) : deTide(place)).then((t) => {
    if (!t.slots.length) throw new Error(`${t.region.tariff} hasn't published prices for ${t.region.name} yet.`);
    return t;
  });
  cache.set(key, { at: Date.now(), tide });
  tide.catch(() => cache.delete(key));
  return tide;
}
