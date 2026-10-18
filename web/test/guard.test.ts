/**
 * Busy and bypass. QA on 18 Oct 2026 left the Echo black on "Setting up…" when Lambda's reserved concurrency
 * returned 429, and the AWS judges reached the whole site on the Lambda Function URL, around CloudFront.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { backoffMs, busyMessage, fetchRetry } from "../lib/echo/retry";
import { originAllowed } from "../lib/originguard";
import { isScheduleEvent, isWarmEvent, runWarm } from "../lib/scheduled";

const noSleep = async () => {};
function fakeFetch(answers: (number | "down")[]) {
  const calls: number[] = [];
  const f = (async () => {
    const a = answers[Math.min(calls.length, answers.length - 1)];
    calls.push(calls.length);
    if (a === "down") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify({ status: a }), { status: a });
  }) as unknown as typeof fetch;
  return { f, calls };
}

test("the Echo's requests retry a throttled (429/503) or unreachable site, then succeed", async () => {
  const { f, calls } = fakeFetch([429, 503, "down", 200]);
  const res = await fetchRetry("/api/homes", { method: "POST" }, { sleep: noSleep }, f);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 4);
});

test("they don't retry an answer that won't change (400, 403), and give up after the last try", async () => {
  const bad = fakeFetch([400, 200]);
  assert.equal((await fetchRetry("/x", undefined, { sleep: noSleep }, bad.f)).status, 400);
  assert.equal(bad.calls.length, 1);
  const busy = fakeFetch([429]);
  assert.equal((await fetchRetry("/x", undefined, { sleep: noSleep, tries: 3 }, busy.f)).status, 429);
  assert.equal(busy.calls.length, 3);
  const down = fakeFetch(["down"]);
  await assert.rejects(fetchRetry("/x", undefined, { sleep: noSleep, tries: 2 }, down.f), /Failed to fetch/);
});

test("backoff grows, stays under its cap, and a busy site gets a sentence a person understands", () => {
  const mid = () => 0.5;
  assert.ok(backoffMs(0, 500, 6000, mid) < backoffMs(2, 500, 6000, mid));
  assert.ok(backoffMs(10, 500, 6000, () => 1) <= 6000);
  assert.match(busyMessage(429)!, /busy/);
  assert.equal(busyMessage(400), null);
});

test("with the origin check on, only requests carrying CloudFront's secret get through (and /events)", () => {
  const env = { check: "on", secret: "s3cret-from-cloudfront-0123456789" };
  assert.equal(originAllowed("/api/health", null, env), false);
  assert.equal(originAllowed("/api/mcp", "guess", env), false);
  assert.equal(originAllowed("/api/mcp", "s3cret-from-cloudfront-012345678X", env), false);
  assert.equal(originAllowed("/api/mcp", env.secret, env), true);
  assert.equal(originAllowed("/", env.secret, env), true);
  // the scheduler's pass-through comes from the adapter on loopback; the route checks its own token
  assert.equal(originAllowed("/events", null, env), true);
  // off, or no secret configured (local dev, the first deploy): everything passes
  assert.equal(originAllowed("/api/mcp", null, { check: "off", secret: env.secret }), true);
  assert.equal(originAllowed("/api/mcp", null, { check: "on", secret: "" }), true);
});

test("the keep-warm event is its own job, and a slow or failing warmer can't hang it", async () => {
  const warm = { source: "lowtide.schedule", job: "warm", token: "x" };
  assert.equal(isWarmEvent(warm), true);
  assert.equal(isScheduleEvent(warm), false);
  assert.equal(isWarmEvent({ source: "lowtide.schedule", job: "tonight" }), false);
  const out = await runWarm([async () => 1, async () => Promise.reject(new Error("feed down")), () => new Promise(() => {})], 50);
  assert.equal(out.warmed, 1);
  assert.equal(out.failed, 2);
  assert.ok(out.ms < 1000);
});
