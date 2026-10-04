export const HALF_HOUR = 30 * 60_000;
export const HOUR = 60 * 60_000;

/** GET with a timeout, one retry, and Next's data cache (`revalidate` seconds) when running inside Next. */
export async function getText(url: string, revalidate = 300, timeoutMs = 8000): Promise<string> {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "user-agent": "Lowtide/1.0 (+https://lowtide-energy.vercel.app)" },
        next: { revalidate },
      } as RequestInit);
      if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
      return await res.text();
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

export async function getJson<T>(url: string, revalidate = 300, timeoutMs = 8000): Promise<T> {
  return JSON.parse(await getText(url, revalidate, timeoutMs)) as T;
}
