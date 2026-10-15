import { dailyCounter, rateLimiter } from "./alexa/budget";
import { cleanSpeech, pollyReady, PollyError, speechKey, synthesize, VOICES, voiceFor, type VoiceRegion } from "./aws/polly";
import { log } from "./log";
import { sameOrigin, visitorIp } from "./origin";
import { storage } from "./storage";

/**
 * POST /api/speak {text, voice: "GB" | "US" | "DE"} → audio/mpeg from Amazon Polly (neural), for the Echo
 * simulator. Same guards as the model route: this site's own pages only, per-visitor caps, and a daily
 * character budget shared through the store (POLLY_DAILY_CHARS, default 40,000, inside Polly's neural free tier
 * of 1 million characters a month). Audio is cached by a hash of voice + text, in memory and in the store, so a
 * repeated sentence costs nothing. Any failure answers 503 and the page speaks with the browser's own voice.
 */
const ipOk = rateLimiter(10 * 60_000, 60, Number(process.env.POLLY_IP_DAILY_CALLS || 400));
const chars = dailyCounter("polly", Number(process.env.POLLY_DAILY_CHARS || 40_000));

const memory = new Map<string, Uint8Array>();
const MEMORY_ITEMS = 64;

type Synth = (text: string, voice: VoiceRegion) => Promise<Uint8Array>;
let synth: Synth = (t, v) => synthesize(t, v);
let custom = false;
/** Tests swap Polly for a fake (which counts as configured). */
export function setSynth(fn: Synth | null) {
  synth = fn ?? ((t, v) => synthesize(t, v));
  custom = Boolean(fn);
  memory.clear();
}

function remember(key: string, audio: Uint8Array) {
  memory.delete(key);
  memory.set(key, audio);
  while (memory.size > MEMORY_ITEMS) memory.delete(memory.keys().next().value as string);
}

async function fromStore(key: string): Promise<Uint8Array | null> {
  const s = storage();
  if (!s) return null;
  const r = await s.read(`speech/${key}.json`).catch(() => null);
  if (!r) return null;
  try {
    const j = JSON.parse(r.text) as { mp3?: string };
    return j.mp3 ? new Uint8Array(Buffer.from(j.mp3, "base64")) : null;
  } catch {
    return null;
  }
}

async function toStore(key: string, voice: string, audio: Uint8Array) {
  const s = storage();
  if (!s) return;
  // bounded, so a slow store never holds the voice back for long
  await Promise.race([
    s.write(`speech/${key}.json`, JSON.stringify({ voice, mp3: Buffer.from(audio).toString("base64") })).catch(() => {}),
    new Promise((r) => setTimeout(r, 1500)),
  ]);
}

const audioResponse = (audio: Uint8Array, voice: VoiceRegion, cached: string) =>
  new Response(audio as unknown as BodyInit, {
    headers: {
      "content-type": "audio/mpeg",
      "content-length": String(audio.length),
      "cache-control": "private, max-age=3600",
      "x-lowtide-voice": `Amazon Polly ${VOICES[voice].id}`,
      "x-lowtide-cache": cached,
    },
  });

const refuse = (status: number, error: string) => Response.json({ error, fallback: "browser" }, { status, headers: { "cache-control": "no-store" } });

export async function speakPost(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return refuse(403, "This endpoint serves the Lowtide site only.");
  let body: { text?: unknown; voice?: unknown };
  try {
    const raw = await req.text();
    if (raw.length > 4000) return refuse(413, "That's too long to say.");
    body = JSON.parse(raw);
  } catch {
    return refuse(400, "Bad request.");
  }
  const text = cleanSpeech(body?.text);
  const voice = voiceFor(body?.voice);
  if (!text) return refuse(400, "Nothing to say.");
  const key = speechKey(text, voice);
  const t0 = Date.now();

  const hot = memory.get(key);
  if (hot) {
    log({ evt: "speak", voice: VOICES[voice].id, chars: text.length, ms: Date.now() - t0, ok: true, cached: "memory" });
    return audioResponse(hot, voice, "memory");
  }
  if (!custom && !pollyReady()) return refuse(503, "Amazon Polly isn't configured here.");
  if (!ipOk(visitorIp(req))) return refuse(429, "That's a lot of speech for one visitor; using the browser's voice for a while.");
  const stored = await fromStore(key);
  if (stored) {
    remember(key, stored);
    log({ evt: "speak", voice: VOICES[voice].id, chars: text.length, ms: Date.now() - t0, ok: true, cached: "store" });
    return audioResponse(stored, voice, "store");
  }
  if (!(await chars.take(text.length))) return refuse(429, "Today's Polly budget is used up; using the browser's voice until tomorrow.");
  try {
    const audio = await synth(text, voice);
    remember(key, audio);
    await toStore(key, VOICES[voice].id, audio);
    log({ evt: "speak", voice: VOICES[voice].id, chars: text.length, ms: Date.now() - t0, ok: true });
    return audioResponse(audio, voice, "miss");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log({ evt: "speak", voice: VOICES[voice].id, chars: text.length, ms: Date.now() - t0, ok: false, error: msg });
    return refuse(e instanceof PollyError && e.status === 400 ? 400 : 503, "Amazon Polly didn't answer; using the browser's voice.");
  }
}

/** GET /api/speak: whether Polly is configured here, and which voices it uses. The page labels the voice from what actually played. */
export function speakGet(): Response {
  return Response.json(
    { engine: pollyReady() ? "polly" : "browser", voices: Object.fromEntries(Object.entries(VOICES).map(([k, v]) => [k, `${v.id} (${v.label}, neural)`])) },
    { headers: { "cache-control": "no-store" } },
  );
}
