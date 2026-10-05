import { offsetMs, zonedToUtc } from "./grid/time";

/**
 * "07:00", "7am", "7:30 pm", "noon", "midnight" or an ISO time -> the next such moment after `now`
 * in the household's zone. Returns null when it can't read the time.
 */
export function nextClockTime(input: string, timeZone: string, now = Date.now()): number | null {
  const s = input.trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}t/.test(s)) {
    // No zone on the end means the household's clock, not the server's.
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})t(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/);
    if (m) return zonedToUtc(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), timeZone);
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
  // Today's date in the zone, then the next calendar day if that moment has passed (a calendar day, not 24 hours: clock changes).
  const local = new Date(now + offsetMs(now, timeZone));
  let t = zonedToUtc(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), h, m, timeZone);
  if (t <= now) t = zonedToUtc(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1, h, m, timeZone);
  return t;
}
