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

const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const MINUTE_WORDS: Record<string, number> = { "": 0, "o'clock": 0, oclock: 0, fifteen: 15, thirty: 30, "forty five": 45, "forty-five": 45 };

export interface Deadline {
  /** the moment, unix ms */
  at: number;
  /** "seven" or "7:30": no a.m./p.m. and not a 24-hour time, so Lowtide picked the next one that fits */
  ambiguous: boolean;
  /** "in ten minutes", "within 2 hours" */
  relative: boolean;
}

/**
 * Reads a deadline (or a start time) the way a person says it, for a load that runs `minutes`.
 *  - "7am", "7 p.m.", "19:00", "07:00", "1930", noon, midnight, ISO: exactly that moment, the next time it comes round.
 *  - "seven", "7", "7:30", "half seven", "seven thirty": no a.m. or p.m., so the next of 7:00 and 19:00 that the
 *    load can still finish by (asked at 2 p.m., a three-hour wash "done by seven" means this evening; asked at
 *    6:30 p.m., it means tomorrow morning).
 *  - "in ten minutes", "in an hour", "within 2 hours", "in half an hour": from now.
 *  - "tomorrow" anywhere ("7am tomorrow", "tomorrow at seven") moves it to tomorrow.
 * Returns null when it can't read it.
 */
export function resolveDeadline(input: string, timeZone: string, now = Date.now(), minutes = 0): Deadline | null {
  let s = input.trim().toLowerCase().replace(/\s+/g, " ");
  const rel = s.match(/^(?:in|within|after)\s+(?:the\s+next\s+)?(an?|one|half an|\d+(?:\.\d+)?|[a-z]+)\s*(minutes?|mins?|hours?|hrs?|h)$/);
  if (rel) {
    const n = rel[1] === "a" || rel[1] === "an" || rel[1] === "one" ? 1 : rel[1] === "half an" ? 0.5 : Number(rel[1]) || WORDS[rel[1]] || NaN;
    if (!Number.isFinite(n) || n <= 0) return null;
    const unit = /^h/.test(rel[2]) ? 3600_000 : 60_000;
    return { at: now + Math.round(n * unit), ambiguous: false, relative: true };
  }
  if (/^in half an hour$/.test(s)) return { at: now + 30 * 60_000, ambiguous: false, relative: true };

  const tomorrow = /\btomorrow\b/.test(s);
  s = s.replace(/\btomorrow\b/g, "").replace(/\b(at|by|before|until|done|finished)\b/g, "").replace(/\b(morning|in the morning)\b/g, "am").replace(/\b(evening|tonight|in the evening|night|afternoon|in the afternoon)\b/g, "pm").replace(/o'?clock/g, "").replace(/\s+/g, " ").trim();
  // "half seven" (British: 7:30), "seven thirty", "quarter past seven"
  let words: { h: number; m: number } | null = null;
  const half = s.match(/^half (?:past )?([a-z]+|\d{1,2})(?: (am|pm))?$/);
  const quarter = s.match(/^quarter (past|to) ([a-z]+|\d{1,2})(?: (am|pm))?$/);
  const spelled = s.match(/^([a-z]+)(?:[ -](fifteen|thirty|forty[ -]five))?(?: (am|pm))?$/);
  let ap: string | undefined;
  const num = (x: string) => (/^\d+$/.test(x) ? Number(x) : WORDS[x]);
  if (half && num(half[1])) {
    words = { h: num(half[1]), m: 30 };
    ap = half[2];
  } else if (quarter && num(quarter[2])) {
    const h = num(quarter[2]);
    words = quarter[1] === "past" ? { h, m: 15 } : { h: h === 1 ? 12 : h - 1, m: 45 };
    ap = quarter[3];
  } else if (spelled && WORDS[spelled[1]]) {
    words = { h: WORDS[spelled[1]], m: MINUTE_WORDS[(spelled[2] ?? "").replace("-", " ")] ?? 0 };
    ap = spelled[3];
  }

  let explicit: number | null;
  let ambiguousHour: { h: number; m: number } | null = null;
  if (words) {
    if (ap) explicit = nextClockTime(`${words.h}:${String(words.m).padStart(2, "0")}${ap}`, timeZone, now);
    else {
      explicit = null;
      ambiguousHour = words;
    }
  } else {
    // A single-digit hour without a.m. or p.m. ("7", "7:30") is ambiguous; "07:00", "19:00" and "7pm" are not.
    const bare = s.match(/^(\d{1,2})(?:[:.h](\d{2}))?$/);
    if (bare && !/^0\d/.test(bare[1]) && Number(bare[1]) >= 1 && Number(bare[1]) <= 12) {
      explicit = null;
      ambiguousHour = { h: Number(bare[1]), m: bare[2] ? Number(bare[2]) : 0 };
      if (ambiguousHour.m > 59) return null;
    } else explicit = nextClockTime(s.replace(/\s+(am|pm)$/, "$1"), timeZone, now);
  }

  if (ambiguousHour) {
    const { h, m } = ambiguousHour;
    const mm = String(m).padStart(2, "0");
    const am = nextClockTime(`${h % 12}:${mm}`, timeZone, now)!;
    const pm = nextClockTime(`${(h % 12) + 12}:${mm}`, timeZone, now)!;
    const need = minutes * 60_000;
    const options = [am, pm].sort((a, b) => a - b);
    let at = options.find((t) => t - now >= need) ?? options[options.length - 1];
    if (tomorrow) {
      // "tomorrow at seven": the first of tomorrow's 7:00 and 19:00 (in practice the morning)
      const next = options.map((t) => (isTomorrow(t, now, timeZone) ? t : t + 86_400_000)).filter((t) => isTomorrow(t, now, timeZone));
      at = Math.min(...next);
    }
    return { at, ambiguous: true, relative: false };
  }
  if (explicit === null) return null;
  // A clock time that passed within the last hour ("13:53" said at 13:53, "2pm" at 2:20) is today's, already
  // gone, not tomorrow's: the run can't make it, and the answer should say so.
  if (!tomorrow && !/^\d{4}-/.test(s) && explicit - now > 23 * 3600_000 && explicit - 86_400_000 >= now - 3600_000) explicit -= 86_400_000;
  if (tomorrow && !isTomorrow(explicit, now, timeZone)) explicit += 86_400_000;
  return { at: explicit, ambiguous: false, relative: false };
}

function isTomorrow(t: number, now: number, timeZone: string): boolean {
  const day = (x: number) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(x));
  return day(t) === day(now + 86_400_000);
}
