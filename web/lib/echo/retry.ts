/**
 * fetch that retries when the site is busy: 429 (Lambda's reserved concurrency is full, or a rate limit),
 * 502/503/504 (a cold or throttled origin behind CloudFront) and network errors, with exponential backoff and
 * jitter. A Retry-After header, when present, sets the wait. Anything else (a 400, a 403, a 200) is returned at
 * once. Only for requests that are safe to repeat: the Echo's set-up, its model turns and its MCP calls are.
 */
export const RETRY_STATUS = new Set([429, 502, 503, 504]);

export interface RetryOptions {
  tries?: number;
  baseMs?: number;
  maxMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, why: string) => void;
}

export function backoffMs(attempt: number, baseMs = 500, maxMs = 6000, rand = Math.random): number {
  const exp = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.round(exp / 2 + rand() * (exp / 2));
}

export async function fetchRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  opts: RetryOptions = {},
  doFetch: typeof fetch = fetch,
): Promise<Response> {
  const tries = opts.tries ?? 5;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let lastError: unknown = null;
  for (let attempt = 0; attempt < tries; attempt++) {
    const last = attempt === tries - 1;
    try {
      const res = await doFetch(input, init);
      if (!RETRY_STATUS.has(res.status) || last) return res;
      const after = Number(res.headers.get("retry-after"));
      opts.onRetry?.(attempt + 1, `HTTP ${res.status}`);
      await res.body?.cancel().catch(() => {});
      await sleep(Number.isFinite(after) && after > 0 ? Math.min(after * 1000, opts.maxMs ?? 6000) : backoffMs(attempt, opts.baseMs, opts.maxMs));
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") throw e;
      lastError = e;
      if (last) break;
      opts.onRetry?.(attempt + 1, "network");
      await sleep(backoffMs(attempt, opts.baseMs, opts.maxMs));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("The network didn't answer.");
}

/** A person-readable reason for a failed set-up or turn. */
export function busyMessage(status: number): string | null {
  if (status === 429 || status === 503) return "Lowtide is busy right now (a lot of people are trying it at once).";
  if (status === 502 || status === 504) return "Lowtide took too long to answer.";
  return null;
}
