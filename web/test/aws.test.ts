/**
 * The AWS side without AWS: SigV4 (static keys and Lambda's temporary credentials) checked against signatures
 * botocore computed for the same requests, credential precedence, the Polly route with Polly replaced by a fake,
 * and the lazy nightly roll ("tonight's plan") on an in-memory store with S3's If-Match semantics.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ORIGINAL_CWD = process.cwd();
const TMP = mkdtempSync(path.join(tmpdir(), "lowtide-aws-"));
process.chdir(TMP);
for (const k of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "S3_BUCKET", "BEDROCK_ACCESS_KEY_ID", "BEDROCK_SECRET_ACCESS_KEY", "POLLY_ACCESS_KEY_ID", "POLLY_SECRET_ACCESS_KEY", "VERCEL", "BLOB_READ_WRITE_TOKEN"]) delete process.env[k];
process.env.POLLY_DAILY_CHARS = "400";
process.on("exit", () => {
  process.chdir(ORIGINAL_CWD);
  rmSync(TMP, { recursive: true, force: true });
});

const { signRequest } = await import("../lib/aws/sigv4");
const { sigv4Headers } = await import("../lib/alexa/sigv4");
const { awsCredentials, credentialKind } = await import("../lib/aws/credentials");
const { synthesize, cleanSpeech, PollyError, MAX_CHARS } = await import("../lib/aws/polly");
const speak = await import("../lib/speak");
const storageMod = await import("../lib/storage");
const store = await import("../lib/store");
const tonight = await import("../lib/tonight");
const { fallbackTurn } = await import("../lib/alexa/fallback");
import type { Storage } from "../lib/storage";
import type { Tide } from "../lib/grid/types";

/* ------------------------------------------------------------------ SigV4 */

// botocore (SigV4Auth / S3SigV4Auth) on the same requests, fake credentials, 2026-10-15T09:11:58Z
const NOW = new Date("2026-10-15T09:11:58Z");
const STATIC = { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" };
const SESSION = { accessKeyId: "ASIAEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", sessionToken: "FwoGZXIvYXdzEXAMPLE//token+with/slashes=" };
const BEDROCK_URL = "https://bedrock-runtime.ap-southeast-2.amazonaws.com/model/apac.amazon.nova-micro-v1%3A0/converse";
const BEDROCK_BODY = '{"messages":[{"role":"user","content":[{"text":"ok"}]}]}';
const sig = (h: Record<string, string>) => h.authorization.split("Signature=")[1];
const signed = (h: Record<string, string>) => h.authorization.split("SignedHeaders=")[1].split(",")[0];

test("sigv4: Bedrock with an IAM user's key matches botocore", () => {
  const h = sigv4Headers(BEDROCK_URL, BEDROCK_BODY, "ap-southeast-2", STATIC.accessKeyId, STATIC.secretAccessKey, NOW);
  assert.equal(signed(h), "content-type;host;x-amz-content-sha256;x-amz-date");
  assert.equal(sig(h), "77774c9057c3e385b0371da3c8e798e6161d4364b580b8aa8d2f94532e9a7053");
  assert.equal(h["x-amz-security-token"], undefined);
});

test("sigv4: Bedrock with Lambda's temporary credentials sends and signs the session token", () => {
  const h = sigv4Headers(BEDROCK_URL, BEDROCK_BODY, "ap-southeast-2", SESSION.accessKeyId, SESSION.secretAccessKey, NOW, SESSION.sessionToken);
  assert.equal(h["x-amz-security-token"], SESSION.sessionToken);
  assert.equal(signed(h), "content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token");
  assert.equal(sig(h), "e8d3c5f7e31483b12e906899443000271d5645fa5d8d8b8c4271be53aeae4bb2");
});

test("sigv4: Polly, S3 PUT with If-Match, and an S3 list with a start-after query, all with a session token", () => {
  const polly = signRequest({ method: "POST", url: "https://polly.ap-southeast-2.amazonaws.com/v1/speech", service: "polly", region: "ap-southeast-2", body: '{"Engine":"neural","OutputFormat":"mp3","Text":"Hello"}', headers: { "content-type": "application/json" }, now: NOW }, SESSION);
  assert.equal(sig(polly), "926cb654b66ac3a9ee5de5533770f957c9ac116becdad5cb093341e1b7120a4e");
  const put = signRequest({ method: "PUT", url: "https://lowtide-homes-0415.s3.ap-southeast-2.amazonaws.com/homes/abcdefghij.json", service: "s3", region: "ap-southeast-2", body: '{"count":3}', headers: { "content-type": "application/json", "if-match": '"0123abcd"' }, now: NOW }, SESSION);
  assert.equal(signed(put), "content-type;host;if-match;x-amz-content-sha256;x-amz-date;x-amz-security-token");
  assert.equal(sig(put), "b38079bc770e5aa0439843d8cdfbac201ad2af4665f64e5ad75d39a88d1b9c56");
  const url = new URL("https://lowtide-homes-0415.s3.ap-southeast-2.amazonaws.com/");
  // the order storage.ts sets them in; SigV4 sorts them
  url.searchParams.set("list-type", "2");
  url.searchParams.set("prefix", "homes/");
  url.searchParams.set("max-keys", "20");
  url.searchParams.set("start-after", "homes/abc.json");
  const list = signRequest({ method: "GET", url, service: "s3", region: "ap-southeast-2", now: NOW }, SESSION);
  assert.equal(sig(list), "24e8bdab232bd9235ba276b4f8bf9c5dad7a82357565d6d9245879b150a56056");
});

test("credentials: a purpose's own key first, then the standard AWS chain (Lambda's role), never Vercel's AWS_* variables", () => {
  const role = { AWS_ACCESS_KEY_ID: "ASIA1", AWS_SECRET_ACCESS_KEY: "s", AWS_SESSION_TOKEN: "t", AWS_LAMBDA_FUNCTION_NAME: "lowtide-web" };
  assert.deepEqual(awsCredentials("bedrock", role), { accessKeyId: "ASIA1", secretAccessKey: "s", sessionToken: "t" });
  assert.equal(credentialKind("polly", role), "role");
  const both = { ...role, BEDROCK_ACCESS_KEY_ID: "AKIA2", BEDROCK_SECRET_ACCESS_KEY: "k" };
  assert.deepEqual(awsCredentials("bedrock", both), { accessKeyId: "AKIA2", secretAccessKey: "k", sessionToken: undefined });
  assert.equal(credentialKind("bedrock", both), "key");
  assert.equal(awsCredentials("s3", both)?.accessKeyId, "ASIA1");
  assert.equal(awsCredentials("polly", { ...role, VERCEL: "1" }), null);
  assert.equal(awsCredentials("bedrock", { AWS_ACCESS_KEY_ID: "x" }), null);
  assert.equal(awsCredentials("s3", {}), null);
});

test("origin: behind CloudFront the visitor's address comes from x-forwarded-host, not the function URL", async () => {
  const { publicOrigin, sameOrigin, visitorIp } = await import("../lib/origin");
  const behind = new Request("http://127.0.0.1:8080/api/homes", { headers: { host: "abc.lambda-url.ap-southeast-2.on.aws", "x-forwarded-host": "d1234.cloudfront.net", "x-forwarded-proto": "https", origin: "https://d1234.cloudfront.net", "x-forwarded-for": "203.0.113.5, 64.252.1.1" } });
  assert.equal(publicOrigin(behind), "https://d1234.cloudfront.net");
  assert.equal(sameOrigin(behind), true);
  assert.equal(visitorIp(behind), "203.0.113.5");
  const direct = new Request("https://abc.lambda-url.ap-southeast-2.on.aws/api/alexa", { headers: { host: "abc.lambda-url.ap-southeast-2.on.aws", origin: "https://d1234.cloudfront.net" } });
  assert.equal(sameOrigin(direct), false);
  assert.equal(publicOrigin(new Request("http://localhost:3000/api/homes", { headers: { host: "localhost:3000" } })), "http://localhost:3000");
});

/* ------------------------------------------------------------------ Polly */

test("polly: SynthesizeSpeech is one signed POST (neural, plain text, the region's voice) and returns the MP3", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const fake = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(new Uint8Array(2048).fill(7), { headers: { "content-type": "audio/mpeg" } });
  }) as unknown as typeof fetch;
  const mp3 = await synthesize("Run the dishwasher at 1 a.m.", "US", { creds: SESSION, region: "ap-southeast-2", fetchImpl: fake });
  assert.equal(mp3.length, 2048);
  assert.equal(seen!.url, "https://polly.ap-southeast-2.amazonaws.com/v1/speech");
  const headers = seen!.init.headers as Record<string, string>;
  assert.equal(headers["x-amz-security-token"], SESSION.sessionToken);
  assert.match(headers.authorization, /\/ap-southeast-2\/polly\/aws4_request/);
  assert.deepEqual(JSON.parse(String(seen!.init.body)), { Engine: "neural", OutputFormat: "mp3", SampleRate: "24000", Text: "Run the dishwasher at 1 a.m.", TextType: "text", VoiceId: "Joanna" });
  const refused = (async () => new Response('{"message":"not authorized"}', { status: 403 })) as unknown as typeof fetch;
  await assert.rejects(synthesize("Hello there", "GB", { creds: SESSION, fetchImpl: refused }), (e: unknown) => e instanceof PollyError && e.status === 403);
  await assert.rejects(synthesize("Hello", "GB", { creds: null }), /credentials are not set/);
});

test("polly: speech is plain text, capped at a sentence boundary", () => {
  assert.equal(cleanSpeech('<speak><prosody rate="x-fast">Hi</prosody></speak>'), 'speak prosody rate="x-fast" Hi /prosody /speak');
  assert.equal(cleanSpeech("  Run it\n\nat *one*  "), "Run it at one");
  const long = cleanSpeech("This is a sentence that goes on. ".repeat(40));
  assert.ok(long.length <= MAX_CHARS && long.endsWith("."));
  assert.equal(cleanSpeech(42), "");
});

function speakReq(body: unknown, origin = "https://d1234.cloudfront.net", ip = "203.0.113.9") {
  return new Request("http://127.0.0.1:8080/api/speak", {
    method: "POST",
    headers: { "content-type": "application/json", origin, host: "abc.lambda-url.ap-southeast-2.on.aws", "x-forwarded-host": "d1234.cloudfront.net", "x-forwarded-for": `${ip}, 64.252.1.1` },
    body: JSON.stringify(body),
  });
}

test("/api/speak: Polly audio for this site's pages only, the region's voice, cached by text, and a 503 the page can fall back from", async () => {
  const calls: [string, string][] = [];
  let fail = false;
  speak.setSynth(async (text, voice) => {
    calls.push([text, voice]);
    if (fail) throw new PollyError("Polly 403: AccessDenied", 403);
    return new Uint8Array(512).fill(1);
  });
  try {
    const foreign = await speak.speakPost(speakReq({ text: "Hello" }, "https://evil.test"));
    assert.equal(foreign.status, 403);
    assert.equal(calls.length, 0);

    const r = await speak.speakPost(speakReq({ text: "Run the dishwasher at 1 a.m.", voice: "GB" }));
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "audio/mpeg");
    assert.equal(r.headers.get("x-lowtide-voice"), "Amazon Polly Amy");
    assert.equal((await r.arrayBuffer()).byteLength, 512);
    const again = await speak.speakPost(speakReq({ text: "Run the dishwasher at 1 a.m.", voice: "GB" }));
    assert.equal(again.headers.get("x-lowtide-cache"), "memory");
    assert.equal(calls.length, 1, "a repeated sentence costs nothing");

    assert.equal((await speak.speakPost(speakReq({ text: "Charge the car at 2 a.m.", voice: "US" }))).headers.get("x-lowtide-voice"), "Amazon Polly Joanna");
    assert.equal((await speak.speakPost(speakReq({ text: "Charge the car at 3 a.m.", voice: "DE" }))).headers.get("x-lowtide-voice"), "Amazon Polly Vicki");
    assert.equal((await speak.speakPost(speakReq({ text: "Charge the car at 4 a.m.", voice: "FR" }))).headers.get("x-lowtide-voice"), "Amazon Polly Amy");
    assert.deepEqual(calls.at(-1), ["Charge the car at 4 a.m.", "GB"]);

    assert.equal((await speak.speakPost(speakReq({ text: "   " }))).status, 400);
    fail = true;
    const down = await speak.speakPost(speakReq({ text: "Something new to say" }));
    assert.equal(down.status, 503);
    assert.equal((await down.json()).fallback, "browser");
  } finally {
    speak.setSynth(null);
  }
});

test("/api/speak: the daily character budget stops Polly, not the page", async () => {
  speak.setSynth(async () => new Uint8Array(256));
  try {
    // POLLY_DAILY_CHARS is 400 in this file; the previous test spent about 100
    let status = 200;
    for (let i = 0; i < 12 && status === 200; i++) status = (await speak.speakPost(speakReq({ text: `Sentence number ${i} is about forty characters long.` }, undefined, "198.51.100.7"))).status;
    assert.equal(status, 429);
  } finally {
    speak.setSynth(null);
  }
});

/* ------------------------------------------------------------------ tonight's plan */

/** S3's semantics in memory: ETags change on every write, If-Match fails with "changed since". */
function memoryStore() {
  const objects = new Map<string, { text: string; etag: string }>();
  let n = 0;
  const writes: string[] = [];
  const s: Storage = {
    async read(key) {
      await Promise.resolve();
      const o = objects.get(key);
      return o ? { text: o.text, etag: o.etag } : null;
    },
    async write(key, text, opts = {}) {
      await Promise.resolve();
      const cur = objects.get(key);
      if (opts.ifMatch !== undefined && cur?.etag !== opts.ifMatch) throw new Error(`write ${key}: the object changed since it was read`);
      objects.set(key, { text, etag: `"e${++n}"` });
      writes.push(key);
    },
    async list(prefix, limit = 1000, startAfter) {
      return [...objects.keys()].filter((k) => k.startsWith(prefix) && (!startAfter || k > startAfter)).sort().slice(0, limit);
    },
  };
  return { s, objects, writes };
}

const T0 = Date.parse("2026-10-15T15:30:00Z"); // 16:30 in London, just after Agile published tomorrow

function tide(opts: { until: number; price?: (t: number) => number; tz?: string; country?: "GB" | "US" | "DE" }): Tide {
  const slots = [];
  for (let t = Date.parse("2026-10-15T15:30:00Z"); t < opts.until; t += 30 * 60_000) {
    slots.push({ start: t, end: t + 30 * 60_000, price: opts.price ? opts.price(t) : 24, carbon: null });
  }
  const tz = opts.tz ?? "Europe/London";
  return {
    region: { country: opts.country ?? "GB", id: "GB-C", name: "London", place: "SE1 7PB", timeZone: tz, currency: "GBP", unit: "p", tariff: "Octopus Agile", priceNote: "", carbonSource: null },
    slots,
    mix: null,
    fetchedAt: T0,
    sources: [],
  };
}

const TOMORROW_23 = Date.parse("2026-10-16T22:00:00Z"); // 23:00 BST, how far Agile reaches after 16:00
const TODAY_23 = Date.parse("2026-10-15T22:00:00Z"); // before publication
// Dear in the evening, very cheap 02:00–04:00 London time (01:00–03:00Z)
const dip = (t: number) => {
  const h = new Date(t).getUTCHours();
  return h >= 1 && h < 3 && t < Date.parse("2026-10-16T05:00:00Z") ? 4 : h >= 16 && h < 19 ? 38 : 22;
};

test("tonight: a night runs 18:00 to 08:00 local, is named by its evening, and survives the clock change", () => {
  const n = tonight.nightOf(T0, "Europe/London");
  assert.deepEqual(n, { night: "2026-10-15", start: Date.parse("2026-10-15T17:00:00Z"), end: Date.parse("2026-10-16T07:00:00Z") });
  assert.equal(tonight.nightOf(Date.parse("2026-10-16T00:30:00Z"), "Europe/London").night, "2026-10-15", "01:30 is still tonight");
  assert.equal(tonight.nightOf(Date.parse("2026-10-16T06:00:00Z"), "Europe/London").night, "2026-10-16", "07:00 starts the next day");
  const dst = tonight.nightOf(Date.parse("2026-10-24T17:00:00Z"), "Europe/London"); // the night the clocks go back
  assert.equal(dst.start, Date.parse("2026-10-24T17:00:00Z"));
  assert.equal(dst.end, Date.parse("2026-10-25T08:00:00Z"), "08:00 GMT after the change");
  assert.equal(tonight.nightOf(Date.parse("2026-10-15T23:00:00Z"), "America/Chicago").night, "2026-10-15");
});

test("tonight: nothing is planned until tomorrow's prices are out; then the best start for each usual appliance, an unusual night said so", () => {
  const apps = tonight.appliancesFor(null);
  assert.deepEqual(apps.map((a) => a.id), ["tumble-dryer", "dishwasher", "washing-machine"]);
  assert.equal(tonight.planTonight(tide({ until: TODAY_23, price: dip }), apps, T0), null);
  const plan = tonight.planTonight(tide({ until: TOMORROW_23, price: dip }), apps, T0)!;
  assert.ok(plan);
  assert.equal(plan.night, "2026-10-15");
  assert.equal(plan.unusual, true);
  assert.equal(plan.items[0].appliance, "tumble-dryer", "the biggest saving leads");
  assert.equal(plan.items[0].start, Date.parse("2026-10-16T01:00:00Z"));
  for (const i of plan.items) assert.ok(i.start >= plan.windowStart && i.end <= plan.windowEnd);
  assert.match(plan.sentence, /^Tonight is unusually cheap: run the tumble dryer at 2 a\.m\., and it costs about 10 pence, \d+ pence less than a typical start\./);
  assert.match(plan.headline, /^Tonight is unusually cheap: tumble dryer at 02:00$/);

  const flat = tonight.planTonight(tide({ until: TOMORROW_23, price: (t) => (new Date(t).getUTCHours() === 3 ? 21 : 24) }), apps, T0)!;
  assert.equal(flat.unusual, false);
  assert.match(flat.sentence, /^Tonight's best time to run the tumble dryer is 3 a\.m\./);
  const paid = tonight.planTonight(tide({ until: TOMORROW_23, price: (t) => (new Date(t).getUTCHours() === 2 ? -3 : 20) }), apps, T0)!;
  assert.match(paid.sentence, /^Tonight you get paid to use power/);
});

test("tonight: a household's plan is computed once a night and stored; asking again, or racing, writes nothing new", async () => {
  const mem = memoryStore();
  storageMod.setStorageForTests(mem.s);
  try {
    const getTide = async () => tide({ until: TOMORROW_23, price: dip });
    const h = await store.createHome("SE1 7PB", "GB", undefined, [
      { id: "r1", appliance: "ev", label: "car", start: T0 - 86_400_000, end: T0 - 80_000_000, kwh: 25, cost: 300, costIfNow: 500, carbon: null, carbonIfNow: null, createdAt: T0 - 86_400_000, status: "planned" },
    ]);
    const key = `homes/${h.home.id}.json`;
    const before = mem.writes.filter((k) => k === key).length;

    const early = await tonight.tonightForHome(h.home.id, { getTide: async () => tide({ until: TODAY_23 }), now: T0 });
    assert.deepEqual([early.plan, early.ready, early.fresh], [null, false, false]);
    assert.equal(mem.writes.filter((k) => k === key).length, before, "nothing written before publication");

    const first = await tonight.tonightForHome(h.home.id, { getTide, now: T0 });
    assert.equal(first.fresh, true);
    assert.equal(first.plan!.items[0].appliance, "ev", "the household's own appliance");
    const second = await tonight.tonightForHome(h.home.id, { getTide, now: T0 + 3600_000 });
    assert.equal(second.fresh, false);
    assert.equal(second.plan!.computedAt, T0);
    assert.equal(mem.writes.filter((k) => k === key).length, before + 1);
    assert.equal((await store.loadHome(h.home.id))!.tonight!.night, "2026-10-15");

    // two instances at once: one writes, the other finds the night planned (If-Match) and leaves it
    const other = await store.createHome("M1 1AE", "GB");
    const otherKey = `homes/${other.home.id}.json`;
    const raced = await Promise.all([0, 1].map(() => tonight.tonightForHome(other.home.id, { getTide, now: T0 })));
    assert.equal(raced.filter((r) => r.fresh).length, 1);
    assert.equal(mem.writes.filter((k) => k === otherKey).length, 2, "the create, and one plan");
    assert.deepEqual(raced[0].plan, raced[1].plan);

    // the next morning, before the next publication, the finished night isn't offered any more
    const morning = await tonight.tonightForHome(h.home.id, { getTide: async () => tide({ until: TOMORROW_23 }), now: Date.parse("2026-10-16T09:00:00Z") });
    assert.equal(morning.plan, null);
  } finally {
    storageMod.setStorageForTests(undefined);
  }
});

test("tonight: the roll plans active households a few at a time from a stored cursor, skips quiet ones, and waits for Agile", async () => {
  const mem = memoryStore();
  storageMod.setStorageForTests(mem.s);
  try {
    const getTide = async () => tide({ until: TOMORROW_23, price: dip });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await store.createHome("SE1 7PB", "GB")).home.id);
    // a household nobody has used for a month
    await mem.s.write("homes/zzzzzzzzzz.json", JSON.stringify({ home: { id: "zzzzzzzzzz", place: "SE1 7PB", country: "GB", createdAt: T0 - 40 * 86_400_000 }, runs: [], overrides: {} }));

    const waiting = await tonight.rollTonight({ getTide: async () => tide({ until: TODAY_23 }), now: T0 });
    assert.equal(waiting.night, null);
    assert.ok(![...mem.objects.keys()].some((k) => k.startsWith("tonight/")));

    const a = await tonight.rollTonight({ getTide, now: T0, limit: 2 });
    assert.deepEqual([a.computed, a.done], [2, false]);
    const b = await tonight.rollTonight({ getTide, now: T0, limit: 2 });
    assert.deepEqual([b.computed, b.skipped], [1, 1]);
    const c = await tonight.rollTonight({ getTide, now: T0, limit: 2 });
    assert.equal(c.done, true);
    const d = await tonight.rollTonight({ getTide, now: T0, limit: 2 });
    assert.deepEqual([d.done, d.computed], [true, 0], "a finished roll does nothing more that night");
    for (const id of ids) assert.equal((await store.loadHome(id))!.tonight?.night, "2026-10-15");
    assert.equal((await store.loadHome("zzzzzzzzzz"))!.tonight, undefined);
    assert.equal(JSON.parse(mem.objects.get("tonight/roll-2026-10-15.json")!.text).computed, 3);
  } finally {
    storageMod.setStorageForTests(undefined);
  }
});

test("tonight: the phrase router sends 'what's the plan for tonight' to get_tonight, and still sends 'cheapest tonight' to get_tide", () => {
  const ask = (text: string) => fallbackTurn([{ role: "user", content: [{ text }] }]).message.content[0];
  const plan = ask("What's the plan for tonight?");
  assert.ok("toolUse" in plan && plan.toolUse.name === "get_tonight");
  const cheap = ask("When is electricity cheapest tonight?");
  assert.ok("toolUse" in cheap && cheap.toolUse.name === "get_tide");
});

/* ------------------------------------------------------------------ the nightly schedule (EventBridge Scheduler) */

const scheduled = await import("../lib/scheduled");
const eventsRoute = await import("../app/events/route");
const SCHEDULE_BODY = JSON.stringify({ source: "lowtide.schedule", job: "tonight" });

test("schedule: /events takes only the Web Adapter's loopback pass-through, never a request through CloudFront or the Function URL", async () => {
  const h = (o: Record<string, string>) => new Headers(o);
  assert.equal(scheduled.scheduledGuard(h({ host: "127.0.0.1:8080", "content-type": "application/json" })), null);
  assert.equal(scheduled.scheduledGuard(h({ host: "localhost:8080" })), null);
  // through CloudFront: the function URL as Host, the viewer's host and CloudFront's own headers alongside
  assert.ok(scheduled.scheduledGuard(h({ host: "abc.lambda-url.ap-southeast-2.on.aws", "x-forwarded-host": "d1soo7510nfzf4.cloudfront.net", via: "2.0 x.cloudfront.net (CloudFront)", "x-amz-cf-id": "x" })));
  // straight at the Function URL: AWS adds x-forwarded-for even when the caller forges Host
  assert.ok(scheduled.scheduledGuard(h({ host: "127.0.0.1:8080", "x-forwarded-for": "203.0.113.9" })));
  assert.ok(scheduled.scheduledGuard(h({ host: "127.0.0.1:8080", via: "1.1 proxy" })));
  assert.ok(scheduled.scheduledGuard(h({})));
  assert.equal(scheduled.isScheduleEvent(JSON.parse(SCHEDULE_BODY)), true);
  assert.equal(scheduled.isScheduleEvent({ source: "aws.events", job: "tonight" }), false);

  const post = (headers: Record<string, string>, body = SCHEDULE_BODY) => eventsRoute.POST(new Request("http://127.0.0.1:8080/events", { method: "POST", headers, body }));
  const outside = await post({ host: "abc.lambda-url.ap-southeast-2.on.aws", "x-forwarded-host": "d1soo7510nfzf4.cloudfront.net", "x-forwarded-for": "203.0.113.9" });
  assert.equal(outside.status, 403);
  assert.equal((await post({ host: "127.0.0.1:8080" }, '{"source":"someone","job":"tonight"}')).status, 400);
  assert.equal((await post({ host: "127.0.0.1:8080" }, "not json")).status, 400);
  assert.equal(eventsRoute.GET().status, 405);
  // the real thing, with no store configured: nothing to plan, still a clean summary
  const local = await post({ host: "127.0.0.1:8080", "content-type": "application/json" });
  assert.equal(local.status, 200);
  const j = await local.json();
  assert.deepEqual([j.ok, j.planned, j.night], [true, 0, null]);
});

test("schedule: one scheduled run plans every active household page by page, waits for Agile, and a second run finds the night done", async () => {
  const mem = memoryStore();
  storageMod.setStorageForTests(mem.s);
  try {
    const getTide = async () => tide({ until: TOMORROW_23, price: dip });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await store.createHome("SE1 7PB", "GB")).home.id);
    await mem.s.write("homes/zzzzzzzzzz.json", JSON.stringify({ home: { id: "zzzzzzzzzz", place: "SE1 7PB", country: "GB", createdAt: T0 - 40 * 86_400_000 }, runs: [], overrides: {} }));

    // 16:45 on a day Agile is late: nothing is published for tomorrow, so nothing is written
    const early = await scheduled.runScheduledTonight({ getTide: async () => tide({ until: TODAY_23 }), now: T0, pageSize: 2 });
    assert.deepEqual([early.night, early.planned, early.steps], [null, 0, 1]);
    assert.ok(![...mem.objects.keys()].some((k) => k.startsWith("tonight/")));

    // 18:30: published; the whole roll in one invocation, two households a page
    const run = await scheduled.runScheduledTonight({ getTide, now: T0, pageSize: 2 });
    assert.deepEqual([run.night, run.planned, run.skipped, run.done], ["2026-10-15", 5, 1, true]);
    assert.ok(run.steps >= 3);
    for (const id of ids) assert.equal((await store.loadHome(id))!.tonight?.night, "2026-10-15");
    assert.equal((await store.loadHome("zzzzzzzzzz"))!.tonight, undefined, "a household quiet for weeks is left alone");

    // a retry, or the next schedule: idempotent, writes no household again
    const writes = mem.writes.filter((k) => k.startsWith("homes/")).length;
    const again = await scheduled.runScheduledTonight({ getTide, now: T0 + 3600_000, pageSize: 2 });
    assert.deepEqual([again.planned, again.done, again.steps], [0, true, 1]);
    assert.equal(mem.writes.filter((k) => k.startsWith("homes/")).length, writes);

    // the time budget bounds a run: an exhausted budget does no work and says it isn't done
    const none = await scheduled.runScheduledTonight({ getTide, now: T0, budgetMs: 0 });
    assert.deepEqual([none.steps, none.done], [0, false]);
  } finally {
    storageMod.setStorageForTests(undefined);
  }
});
