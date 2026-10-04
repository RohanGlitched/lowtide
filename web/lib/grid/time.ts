/** Wall-clock time in `timeZone` -> unix ms (month is 0-based, like Date.UTC). */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, timeZone: string): number {
  const guess = Date.UTC(y, mo, d, h, mi);
  // Two passes settle the offset, including across DST changes.
  let t = guess - offsetMs(guess, timeZone);
  t = guess - offsetMs(t, timeZone);
  return t;
}

/** The zone's UTC offset at instant `t`, in ms (London summer: +3600000). */
export function offsetMs(t: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(t));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(t / 1000) * 1000;
}

/** "01:30" in the household's zone. */
export function clock(t: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
}

/** "tonight", "tomorrow morning", "this afternoon"... relative to `now`, in the zone. */
export function dayPart(t: number, now: number, timeZone: string): string {
  const day = (x: number) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(x));
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(new Date(t)));
  const sameDay = day(t) === day(now);
  const nextDay = day(t) === day(now + 86400_000);
  if (sameDay) {
    if (hour < 5) return "early this morning";
    if (hour < 12) return "this morning";
    if (hour < 17) return "this afternoon";
    if (hour < 21) return "this evening";
    return "tonight";
  }
  if (nextDay) {
    if (hour < 5) return "tonight";
    if (hour < 12) return "tomorrow morning";
    if (hour < 17) return "tomorrow afternoon";
    return "tomorrow evening";
  }
  return new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long" }).format(new Date(t));
}

/** Spoken clock time: "1:30 a.m.", "9 p.m.", "midnight". */
export function spokenTime(t: number, timeZone: string): string {
  const [h, m] = clock(t, timeZone).split(":").map(Number);
  if (h === 0 && m === 0) return "midnight";
  if (h === 12 && m === 0) return "noon";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? ":" + String(m).padStart(2, "0") : ""} ${h < 12 ? "a.m." : "p.m."}`;
}
