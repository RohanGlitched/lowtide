import type { Country, Tide } from "./types";
import { parsePostcode, ukTide } from "./uk";
import { usTide } from "./us";
import { deTide } from "./de";

export * from "./types";

const cache = new Map<string, { at: number; tide: Promise<Tide> }>();
const FRESH_MS = 120_000;

/**
 * British places people say instead of a postcode: cities, and the Agile regions by the names Lowtide speaks, each
 * mapped to a postcode in it. The answer names the region back ("Electricity in North Western England ..."), so
 * the person hears which tariff region they got.
 */
const UK_PLACES: Record<string, string> = {
  london: "SE1 7PB", manchester: "M1 1AE", birmingham: "B1 1BB", glasgow: "G1 1XQ", edinburgh: "EH1 1YZ", cardiff: "CF10 1EP",
  bristol: "BS1 4DJ", leeds: "LS1 1UR", liverpool: "L1 8JQ", newcastle: "NE1 7RU", "newcastle upon tyne": "NE1 7RU",
  sheffield: "S1 2HH", nottingham: "NG1 5FS", leicester: "LE1 5YA", southampton: "SO14 7DU", brighton: "BN1 1AE", oxford: "OX1 1BX",
  cambridge: "CB2 1TN", norwich: "NR2 1NH", plymouth: "PL1 1EA", exeter: "EX1 1GA", aberdeen: "AB10 1AB", dundee: "DD1 1DB",
  inverness: "IV1 1AA", swansea: "SA1 1NW", york: "YO1 7HH", hull: "HU1 1AA", coventry: "CV1 5RR", reading: "RG1 1AX",
  "milton keynes": "MK9 2EA", portsmouth: "PO1 2AL", derby: "DE1 1AN", bath: "BA1 1SU", chester: "CH1 1SN", ipswich: "IP1 1BW",
  bradford: "BD1 1HY", wolverhampton: "WV1 1SH", sunderland: "SR1 3AA", middlesbrough: "TS1 2AA", stoke: "ST1 1HP",
  "stoke-on-trent": "ST1 1HP", newport: "NP20 1AA", wrexham: "LL11 1AA", bangor: "LL57 1AA", stirling: "FK8 1AA", perth: "PH1 5AA",
  // the 14 Agile regions, and the ways people name them
  "eastern england": "CB2 1TN", "east england": "CB2 1TN", "east of england": "CB2 1TN", "east anglia": "CB2 1TN",
  "east midlands": "NG1 5FS", "west midlands": "B1 1BB", midlands: "B1 1BB",
  "north eastern england": "NE1 7RU", "north east england": "NE1 7RU", "north east": "NE1 7RU", "the north east": "NE1 7RU",
  "north western england": "M1 1AE", "north west england": "M1 1AE", "north west": "M1 1AE", "the north west": "M1 1AE",
  "merseyside and north wales": "L1 8JQ", merseyside: "L1 8JQ", "north wales": "LL57 1AA",
  "southern england": "SO14 7DU", "south of england": "SO14 7DU", "south east england": "BN1 1AE", "south eastern england": "BN1 1AE",
  "south east": "BN1 1AE", "the south east": "BN1 1AE", "south west england": "PL1 1EA", "south western england": "PL1 1EA",
  "south west": "PL1 1EA", "the south west": "PL1 1EA", "southern wales": "CF10 1EP", "south wales": "CF10 1EP", wales: "CF10 1EP",
  yorkshire: "LS1 1UR", "southern scotland": "G1 1XQ", "south scotland": "G1 1XQ", scotland: "G1 1XQ",
  "northern scotland": "IV1 1AA", "north scotland": "IV1 1AA", highlands: "IV1 1AA", "the highlands": "IV1 1AA",
};

/** A British city or region name as the postcode Lowtide prices it by; anything else unchanged. */
export function normalizePlace(place: string): string {
  const p = place.trim().toLowerCase().replace(/[.!?]+$/, "").replace(/,?\s*(uk|u\.k\.|united kingdom|gb|great britain|britain)$/, "").replace(/\s+/g, " ").trim();
  return UK_PLACES[p] ?? UK_PLACES[p.replace(/,?\s*england$/, "").trim()] ?? place;
}

/** Which tariff region a household is in, from what they told us. */
export function resolveCountry(place: string, country?: Country): Country {
  if (country) return country;
  place = normalizePlace(place);
  const p = place.trim().toLowerCase();
  const pc = parsePostcode(place);
  if (pc && /^BT\d/.test(pc.outward)) {
    throw new Error("Northern Ireland isn't on Octopus Agile, so Lowtide can't price it yet. It covers Great Britain, northern Illinois and Germany.");
  }
  if (pc) return "GB";
  if (/\b(germany|deutschland|berlin|munich|münchen|hamburg|köln|cologne|frankfurt|stuttgart|düsseldorf|dusseldorf|leipzig|dresden)\b/.test(p)) return "DE";
  // ComEd serves northern Illinois; central and southern Illinois are Ameren's, which Lowtide doesn't have yet.
  if (/\b(springfield|peoria|champaign|urbana|bloomington|decatur|carbondale|belleville|quincy|ameren)\b/.test(p) || /^6(1[2-9]|2[0-9])[0-9]{2}$/.test(p)) {
    throw new Error("Lowtide has ComEd's hourly prices for northern Illinois. Ameren Illinois, which serves central and southern Illinois, isn't in yet.");
  }
  if (/\b(illinois|chicago|evanston|naperville|aurora|rockford|joliet|elgin|waukegan|schaumburg|oak park|il)\b/.test(p) || /^60[0-9]{3}$/.test(p) || /^61[01][0-9]{2}$/.test(p)) return "US";
  // Any other five-digit code is a German Postleitzahl.
  if (/^(de-?)?\d{5}$/.test(p)) return "DE";
  throw new Error(
    `I couldn't place "${place}". Try a city like Manchester or a UK postcode; Lowtide covers Great Britain, northern Illinois (ComEd) and Germany.`,
  );
}

export async function getTide(place: string, country?: Country): Promise<Tide> {
  place = normalizePlace(place);
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
