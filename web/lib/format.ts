import type { Region } from "./grid/types";

/** An amount in minor units (p, ¢, ct) as a person says it: "11p", "£1.24", "8¢", "$2.10", "9 ct", "€1.05". */
export function money(minor: number, region: Pick<Region, "currency">): string {
  // Round first, so 99.6p reads £1.00 and a hair below zero isn't "−0p".
  const v = Math.abs(minor) >= 10 ? Math.round(Math.abs(minor)) : Math.round(Math.abs(minor) * 10) / 10;
  const neg = minor < 0 && v > 0;
  let s: string;
  if (region.currency === "GBP") s = v < 100 ? `${fmt(v)}p` : `£${(v / 100).toFixed(2)}`;
  else if (region.currency === "USD") s = v < 100 ? `${fmt(v)}¢` : `$${(v / 100).toFixed(2)}`;
  else s = v < 100 ? `${fmt(v)} ct` : `€${(v / 100).toFixed(2)}`;
  return neg ? `−${s}` : s;
}

/** Spoken form: "11 pence", "1 pound 24", "8 cents". */
export function moneySpoken(minor: number, region: Pick<Region, "currency">): string {
  const v = Math.round(Math.abs(minor));
  const credit = minor < 0 ? " back" : "";
  if (region.currency === "GBP") {
    if (v < 100) return `${v} ${v === 1 ? "penny" : "pence"}${credit}`;
    return `£${Math.floor(v / 100)}${v % 100 ? "." + String(v % 100).padStart(2, "0") : ""}${credit}`;
  }
  if (region.currency === "USD") {
    if (v < 100) return `${v} ${v === 1 ? "cent" : "cents"}${credit}`;
    return `$${(v / 100).toFixed(2)}${credit}`;
  }
  if (v < 100) return `${v} ${v === 1 ? "cent" : "cents"}${credit}`;
  return `€${(v / 100).toFixed(2)}${credit}`;
}

/** Unit price: "6.1p/kWh". */
export function rate(minorPerKwh: number, region: Pick<Region, "unit">): string {
  const u = region.unit === "ct" ? " ct" : region.unit;
  return `${minorPerKwh < 0 ? "−" : ""}${Math.abs(minorPerKwh).toFixed(1)}${u}/kWh`;
}

/** "3 h", "2 h 30", "45 min". */
export function duration(minutes: number): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

/** Grams to "320 g" or "1.4 kg". */
export function grams(g: number): string {
  const r = Math.round(g);
  return r >= 1000 ? `${(r / 1000).toFixed(1)} kg` : `${r} g`;
}

function fmt(v: number): string {
  return v >= 10 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, "");
}
