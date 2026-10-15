import { createHash } from "node:crypto";
import { awsCredentials } from "./credentials";
import { signRequest, type AwsCredentials } from "./sigv4";

/**
 * Amazon Polly for the Echo simulator's voice: SynthesizeSpeech with the neural engine, plain text only (no SSML,
 * so nothing a tool result says can change how it is spoken), one voice per tariff region:
 * Amy (British English) for Octopus Agile, Joanna (American English) for ComEd, Vicki (German) for EPEX.
 */
export type VoiceRegion = "GB" | "US" | "DE";

export const VOICES: Record<VoiceRegion, { id: string; lang: string; label: string }> = {
  GB: { id: "Amy", lang: "en-GB", label: "British English" },
  US: { id: "Joanna", lang: "en-US", label: "American English" },
  DE: { id: "Vicki", lang: "de-DE", label: "German" },
};

export const MAX_CHARS = 600;
export const POLLY_REGION = () => process.env.POLLY_REGION || process.env.BEDROCK_REGION || "ap-southeast-2";

export const voiceFor = (v: unknown): VoiceRegion => (v === "US" || v === "DE" ? v : "GB");

/** Plain text a person would hear: no markup characters, no runs of whitespace, at most MAX_CHARS (cut at a sentence). */
export function cleanSpeech(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let t = raw.replace(/[<>{}\[\]\\`*_#|~^]/g, " ").replace(/\s+/g, " ").trim();
  if (t.length > MAX_CHARS) {
    const cut = t.slice(0, MAX_CHARS);
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
    t = end > MAX_CHARS / 2 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "") + ".";
  }
  return t;
}

/** The cache key: same words, same voice, same audio. */
export const speechKey = (text: string, voice: VoiceRegion) => createHash("sha256").update(`${VOICES[voice].id}\n${text}`).digest("hex").slice(0, 32);

export const pollyReady = () => Boolean(awsCredentials("polly"));

export class PollyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** One SynthesizeSpeech call; returns MP3 bytes. */
export async function synthesize(text: string, voice: VoiceRegion, opts: { creds?: AwsCredentials | null; region?: string; fetchImpl?: typeof fetch; now?: Date } = {}): Promise<Uint8Array> {
  const creds = opts.creds === undefined ? awsCredentials("polly") : opts.creds;
  if (!creds) throw new PollyError("Amazon Polly credentials are not set", 503);
  const region = opts.region ?? POLLY_REGION();
  const url = `https://polly.${region}.amazonaws.com/v1/speech`;
  const body = JSON.stringify({ Engine: "neural", OutputFormat: "mp3", SampleRate: "24000", Text: text, TextType: "text", VoiceId: VOICES[voice].id });
  const headers = signRequest({ method: "POST", url, service: "polly", region, body, headers: { "content-type": "application/json" }, now: opts.now }, creds);
  const res = await (opts.fetchImpl ?? fetch)(url, { method: "POST", headers, body, signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new PollyError(`Polly ${res.status}: ${detail.slice(0, 200)}`, res.status);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length < 100) throw new PollyError("Polly returned no audio", 502);
  return bytes;
}
