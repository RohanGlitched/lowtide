/**
 * Structured logs: one JSON line per event (a tool call, a model turn, a Polly request, a nightly roll, a scheduled run), so
 * CloudWatch Logs Insights can query them and the stack's metric filters can count them without parsing prose.
 *
 *   fields @timestamp, tool, ms, ok | filter evt = "tool" | stats avg(ms) by tool
 *
 * Never logs the conversation, the household id in full or any credential: only names, timings and counts.
 */
export type LogEvent =
  | { evt: "tool"; tool: string; ms: number; ok: boolean; home?: boolean; error?: string }
  | { evt: "model"; engine: "bedrock" | "fallback"; model?: string; ms: number; ok: boolean; stop?: string; inputTokens?: number; outputTokens?: number; note?: string; error?: string }
  | { evt: "speak"; voice: string; chars: number; ms: number; ok: boolean; cached?: "memory" | "store"; error?: string }
  | { evt: "tonight"; scope: "home" | "roll"; ms: number; ok: boolean; computed?: number; skipped?: number; night?: string; error?: string }
  | { evt: "schedule"; job: "tonight"; ms: number; ok: boolean; night?: string | null; planned?: number; skipped?: number; steps?: number; done?: boolean; error?: string }
  | { evt: "warm"; warmed: number; failed: number; ms: number; error?: string }
  | { evt: "oauth"; step: "token" | "revoke" | "register" | "consent" | "mcp"; ok: boolean; grant?: string; service?: boolean; reason?: string; error?: string };

export function log(e: LogEvent): void {
  // quiet under `node --test` unless a test asks for the lines
  if (process.env.LOWTIDE_QUIET_LOGS === "1" || (process.env.NODE_TEST_CONTEXT && process.env.LOWTIDE_LOGS !== "1")) return;
  const line = { t: new Date().toISOString(), ...e, ...(e.error ? { error: e.error.slice(0, 300) } : {}) };
  // Straight to stdout, one line per event: Lambda (CloudWatch Logs) and Vercel capture it as is, without the
  // runtime's "timestamp requestId INFO" prefix that console.log gets, so metric filters can parse the JSON.
  process.stdout.write(JSON.stringify(line) + "\n");
}

/** Times `fn` and logs one line whether it resolves or throws. */
export async function timed<T>(make: (ms: number, ok: boolean, error?: string) => LogEvent, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try {
    const out = await fn();
    log(make(Date.now() - t0, true));
    return out;
  } catch (e) {
    log(make(Date.now() - t0, false, e instanceof Error ? e.message : String(e)));
    throw e;
  }
}
