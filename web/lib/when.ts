import { offsetMs, zonedToUtc } from "./grid/time";

/**
 * "07:00", "7am", "7:30 pm", "noon", "midnight" or an ISO time -> the next such moment after `now`
 * in the household's zone. Returns null when it can't read the time.
 */
export function nextClockTime(input: string, timeZone: string, now = Date.now()): number | null {
  const s = input.trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}t/.test(s)) {
    const t = Date.parse(input);
    return Number.isFinite(t) ? t : null;
  }
  let h: number;
  let m = 0;
  if (s === "noon" || s === "midday") h = 12;
  else if (s === "midnight") h = 0;
  else {
    const mm = s.match(/^(\d{1,2})(?::|\.|h)?(\d{2})?\s*(a\.?m\.?|p\.?m\.?)?$/);
    if (!mm) return null;
    h = Number(mm[1]);
    m = mm[2] ? Number(mm[2]) : 0;
    const ap = mm[3]?.replace(/\./g, "");
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    if (h > 23 || m > 59) return null;
  }
  // Today's date in the zone, then roll forward a day if that moment has passed.
  const local = new Date(now + offsetMs(now, timeZone));
  let t = zonedToUtc(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), h, m, timeZone);
  if (t <= now) {
    const tomorrow = new Date(now + 86400_000 + offsetMs(now + 86400_000, timeZone));
    t = zonedToUtc(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), h, m, timeZone);
  }
  return t;
}
