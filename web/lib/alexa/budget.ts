import "server-only";
import { get, put } from "@vercel/blob";

/**
 * Spend guards for the public demo, so judges can't run up the Bedrock bill:
 * - per visitor (IP): 40 model calls per 10 minutes, kept in memory per server instance;
 * - per day: DAILY_MODEL_CAP calls in total (default 1500 ≈ a few dollars of Haiku), counted in memory and
 *   flushed to a private blob every 20 calls so the cap holds across instances.
 * When either runs out, the simulator keeps working on the deterministic intent router.
 */
const IP_WINDOW_MS = 10 * 60_000;
const IP_LIMIT = 40;
const DAILY_CAP = Number(process.env.DAILY_MODEL_CAP || 1500);
const FLUSH_EVERY = 20;

const ipCalls = new Map<string, number[]>();

export function ipAllowed(ip: string): boolean {
  const now = Date.now();
  const recent = (ipCalls.get(ip) ?? []).filter((t) => now - t < IP_WINDOW_MS);
  if (recent.length >= IP_LIMIT) {
    ipCalls.set(ip, recent);
    return false;
  }
  recent.push(now);
  ipCalls.set(ip, recent);
  if (ipCalls.size > 5000) ipCalls.clear();
  return true;
}

let day = "";
let persisted = 0; // count stored in the blob when we last synced
let local = 0; // calls this instance made since then

const today = () => new Date().toISOString().slice(0, 10);
const key = (d: string) => `usage/${d}.json`;

async function readCount(d: string): Promise<{ count: number; etag?: string }> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return { count: 0 };
  const r = await get(key(d), { access: "private", useCache: false }).catch(() => null);
  if (!r?.stream) return { count: 0 };
  const j = JSON.parse(await new Response(r.stream).text()) as { count: number };
  return { count: j.count ?? 0, etag: r.blob.etag };
}

async function flush(): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN || local === 0) return;
  for (let i = 0; i < 3; i++) {
    const cur = await readCount(day);
    try {
      await put(key(day), JSON.stringify({ count: cur.count + local }), {
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: true,
        ...(cur.etag ? { ifMatch: cur.etag } : {}),
      });
      persisted = cur.count + local;
      local = 0;
      return;
    } catch {
      /* someone else wrote first: re-read and retry */
    }
  }
}

/** Takes one model call from today's budget; false when the day's cap is spent. */
export async function takeDaily(): Promise<boolean> {
  const d = today();
  if (d !== day) {
    day = d;
    local = 0;
    persisted = (await readCount(d).catch(() => ({ count: 0 }))).count;
  }
  if (persisted + local >= DAILY_CAP) return false;
  local++;
  if (local >= FLUSH_EVERY) await flush().catch(() => {});
  return true;
}
