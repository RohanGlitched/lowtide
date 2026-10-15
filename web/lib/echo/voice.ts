"use client";

/** Browser speech: recognition where the browser has it (Chrome, Edge, Safari), synthesis everywhere. */

type Rec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

export function canListen(): boolean {
  return typeof window !== "undefined" && Boolean((window as never as Record<string, unknown>).SpeechRecognition || (window as never as Record<string, unknown>).webkitSpeechRecognition);
}

/** Listens once; calls `onPartial` with interim text and resolves with the final transcript ("" on silence). */
export function listen(lang: string, onPartial: (t: string) => void): { done: Promise<string>; stop: () => void } {
  const W = window as never as Record<string, new () => Rec>;
  const R = W.SpeechRecognition || W.webkitSpeechRecognition;
  const rec = new R();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = false;
  let finalText = "";
  let latest = "";
  const done = new Promise<string>((resolve, reject) => {
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      latest = (finalText + interim).trim();
      onPartial(latest);
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") resolve("");
      else reject(new Error(e.error === "not-allowed" ? "Microphone access was blocked. Allow it, or type instead." : `Speech recognition failed (${e.error}).`));
    };
    rec.onend = () => resolve((finalText || latest).trim());
  });
  rec.start();
  return { done, stop: () => rec.stop() };
}

const PREFERRED = [
  /Microsoft (Aria|Jenny|Ava|Emma) Online/i,
  /Google UK English Female/i,
  /Google US English/i,
  /Samantha|Serena|Karen|Moira|Tessa/i,
  /Microsoft (Libby|Sonia|Hazel|Zira)/i,
];

let chosen: SpeechSynthesisVoice | null = null;

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  if (chosen) return chosen;
  const voices = speechSynthesis.getVoices();
  for (const re of PREFERRED) {
    const v = voices.find((x) => re.test(x.name));
    if (v) return (chosen = v);
  }
  return (chosen = voices.find((v) => v.lang.startsWith(lang.slice(0, 2))) ?? null);
}

/** Speaks `text`; resolves when finished (or immediately if speech is unavailable or muted). */
export function speak(text: string, lang: string, muted: boolean): Promise<void> {
  if (muted || typeof speechSynthesis === "undefined" || !text) return Promise.resolve();
  speechSynthesis.cancel();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice(lang);
    if (v) u.voice = v;
    u.lang = v?.lang ?? lang;
    u.rate = 1.02;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
    // Some browsers never fire onend for long text; don't hang the UI.
    setTimeout(resolve, 2500 + text.length * 90);
  });
}

let playing: HTMLAudioElement | null = null;
let generation = 0;

export function stopSpeaking() {
  generation++;
  if (playing) {
    playing.pause();
    playing = null;
  }
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}

export type VoiceRegion = "GB" | "US" | "DE";
export type Spoken = { used: "polly" | "browser" | "none"; voice?: string };

/** The browser's language for each region's fallback voice (the replies are English everywhere). */
const BROWSER_LANG: Record<VoiceRegion, string> = { GB: "en-GB", US: "en-US", DE: "en-GB" };

/**
 * Speaks `text` with Amazon Polly (neural; Amy for Britain, Joanna for Illinois, Vicki for Germany) through
 * /api/speak, and falls back to the browser's own speech if Polly is unavailable, over budget, or the audio
 * can't play. Resolves when finished, with the voice that actually spoke, so the page labels it truthfully.
 */
export async function speakAloud(text: string, region: VoiceRegion, muted: boolean, polly = true): Promise<Spoken> {
  if (muted || !text) return { used: "none" };
  stopSpeaking();
  const gen = generation;
  try {
    // where Polly isn't configured (Vercel, local), don't ask: the browser speaks and the console stays clean
    if (!polly) throw new Error("polly off");
    const r = await fetch("/api/speak", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, voice: region }),
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) throw new Error(`speak ${r.status}`);
    const voice = r.headers.get("x-lowtide-voice") ?? "Amazon Polly";
    const url = URL.createObjectURL(await r.blob());
    if (gen !== generation) {
      URL.revokeObjectURL(url);
      return { used: "none" };
    }
    const audio = new Audio(url);
    playing = audio;
    try {
      await new Promise<void>((resolve, reject) => {
        audio.onended = () => resolve();
        audio.onerror = () => reject(new Error("audio"));
        audio.onpause = () => resolve(); // stopped by the person
        audio.play().catch(reject);
        // never hang the UI on a stalled stream
        setTimeout(resolve, 4000 + text.length * 120);
      });
    } finally {
      URL.revokeObjectURL(url);
      if (playing === audio) playing = null;
    }
    return { used: "polly", voice };
  } catch {
    if (gen !== generation) return { used: "none" };
    await speak(text, BROWSER_LANG[region], false);
    return { used: typeof speechSynthesis === "undefined" ? "none" : "browser" };
  }
}
