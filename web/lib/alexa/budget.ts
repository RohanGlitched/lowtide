import { storage } from "../storage";

/**
 * Spend guards for the public demo, so judges can't run up the AWS bill:
 * - per visitor (IP): 40 model calls per 10 minutes and 250 a day, kept in memory per server instance;
 * - per day: DAILY_MODEL_CAP calls in total (default 1500, a few cents of Nova Micro), counted in memory and
 *   flushed to the store every 20 calls (and on every call once 80% is spent) so the cap holds across instances.
 * The same two guards, with their own numbers, cap Amazon Polly (characters a day, see lib/aws/polly.ts).
 * When either runs out, the simulator keeps working on the deterministic intent router and the browser's voice.
 */

/** A per-visitor limiter: `windowLimit` per `windowMs`, `dayLimit` per day, in memory per instance. */
export function rateLimiter(windowMs: number, windowLimit: number, dayLimit: number) {
  const calls = new Map<string, number[]>();
  return function allowed(ip: string): boolean {
    const now = Date.now();
    const list = (calls.get(ip) ?? []).filter((t) => now - t < 86_400_000);
    const recent = list.filter((t) => now - t < windowMs);
    if (recent.length >= windowLimit || list.length >= dayLimit) {
      calls.set(ip, list);
      return false;
    }
    list.push(now);
    calls.set(ip, list);
    if (calls.size > 5000) {
      // Forget the quiet addresses, not everyone.
      for (const [k, v] of calls) if (!v.some((t) => now - t < windowMs)) calls.delete(k);
    }
    return true;
  };
}

export const ipAllowed = rateLimiter(10 * 60_000, 40, Number(process.env.IP_DAILY_MODEL_CAP || 250));

/**
 * A daily total shared by every instance through the store (`usage/<name>-<day>.json`, or `usage/<day>.json`
 * for the model budget, as it always was). Units are whatever the caller takes: calls, or characters.
 */
export function dailyCounter(name: string, cap: number, flushEvery = 20) {
  let day = "";
  let persisted = 0; // total stored when we last synced
  let local = 0; // units this instance took since then
  let calls = 0; // takes since the last sync

  const today = () => new Date().toISOString().slice(0, 10);
  const key = (d: string) => (name === "model" ? `usage/${d}.json` : `usage/${name}-${d}.json`);

  async function readCount(d: string): Promise<{ count: number; etag?: string }> {
    const s = storage();
    if (!s) return { count: 0 };
    const r = await s.read(key(d)).catch(() => null);
    if (!r) return { count: 0 };
    const j = JSON.parse(r.text) as { count: number };
    return { count: j.count ?? 0, etag: r.etag };
  }

  async function flush(): Promise<void> {
    const s = storage();
    if (!s || local === 0) return;
    for (let i = 0; i < 3; i++) {
      const cur = await readCount(day);
      try {
        await s.write(key(day), JSON.stringify({ count: cur.count + local }), { ifMatch: cur.etag });
        persisted = cur.count + local;
        local = 0;
        calls = 0;
        return;
      } catch {
        /* someone else wrote first: re-read and retry */
      }
    }
  }

  return {
    cap,
    /** Takes `n` units from today's budget; false (and nothing taken) when they don't fit. */
    async take(n = 1): Promise<boolean> {
      const d = today();
      if (d !== day) {
        const count = (await readCount(d).catch(() => ({ count: 0 }))).count;
        if (d !== day) {
          day = d;
          local = 0;
          calls = 0;
          persisted = count;
        }
      }
      if (persisted + local + n > cap) return false;
      local += n;
      calls++;
      // Sync every few takes, and on every take once the day is 80% spent, so instances can't overshoot by much.
      const near = persisted + local >= cap * 0.8;
      if (calls >= flushEvery || near) await flush().catch(() => {});
      return true;
    },
    /** What this instance believes is spent today (for health pages and tests). */
    spent: () => persisted + local,
  };
}

const model = dailyCounter("model", Number(process.env.DAILY_MODEL_CAP || 1500));

/** Takes one model call from today's budget; false when the day's cap is spent. */
export const takeDaily = () => model.take(1);
