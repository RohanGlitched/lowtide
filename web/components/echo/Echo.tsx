"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { callTool, connect, mountView, type Connection, type MountedView } from "@/lib/echo/host";
import { canListen, listen, speak, stopSpeaking } from "@/lib/echo/voice";
import type { Message, ToolSpec, TurnResponse } from "@/lib/alexa/types";
import s from "./echo.module.css";

type Phase = "connecting" | "idle" | "listening" | "thinking" | "speaking";
type Line = { who: "you" | "alexa" | "tool" | "note"; text: string; engine?: string };
interface Household {
  id: string;
  place: string;
  region: string;
  tariff: string;
  mcpUrl: string;
  demo?: boolean;
}

const HOME_KEY = "lowtide.echo.home.v1";
const DEFAULT_PLACE = "SE1 7PB";

const SUGGESTIONS = [
  "When should I run the dishwasher?",
  "Is now a good time to use the tumble dryer?",
  "Charge the car by 7 a.m., greenest please",
  "When is electricity cheapest tonight?",
  "What have I got planned?",
  "How much have I saved?",
];

const ZONES: Record<string, string> = { GB: "Europe/London", US: "America/Chicago", DE: "Europe/Berlin" };

function toolLine(name: string, input: Record<string, unknown>) {
  const args = Object.entries(input)
    .filter(([k]) => k !== "start")
    .map(([k, v]) => `${k.replace("_", " ")} ${v}`)
    .join(", ");
  return `${name}(${args})`;
}

function specsOf(conn: Connection): ToolSpec[] {
  return conn.tools.map((t) => {
    const { $schema: _drop, ...schema } = (t.inputSchema ?? { type: "object" }) as Record<string, unknown>;
    return { name: t.name, description: t.description ?? t.title ?? t.name, inputSchema: schema };
  });
}

export default function Echo() {
  const screen = useRef<HTMLDivElement>(null);
  const view = useRef<MountedView | null>(null);
  const conn = useRef<Connection | null>(null);
  const messages = useRef<Message[]>([]);
  const stopListening = useRef<(() => void) | null>(null);
  const logEnd = useRef<HTMLLIElement>(null);

  const [phase, setPhase] = useState<Phase>("connecting");
  const [home, setHome] = useState<Household | null>(null);
  const [caption, setCaption] = useState<{ who: "you" | "alexa"; text: string } | null>(null);
  const [log, setLog] = useState<Line[]>([]);
  const [typed, setTyped] = useState("");
  const [muted, setMuted] = useState(false);
  const [mic, setMic] = useState(false);
  const [engine, setEngine] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [placeInput, setPlaceInput] = useState("");
  const [copied, setCopied] = useState(false);

  const tz = ZONES[guessCountry(home?.region ?? "")];
  const say = (l: Line) => setLog((xs) => [...xs.slice(-60), l]);

  // The Echo's screen is a dark instrument, whatever the page around it.
  const theme = () => "dark" as const;

  const show = useCallback(async (name: string, input: Record<string, unknown>, result: CallToolResult) => {
    if (!conn.current || !screen.current) return;
    const old = view.current;
    const next = await mountView(screen.current, conn.current, name, input, result, theme());
    if (next) {
      old?.dispose();
      view.current = next;
    }
  }, []);

  // Household: reuse the one in this browser, or make a demo household with two weeks of history.
  const setup = useCallback(
    async (place: string, fresh: boolean) => {
      setPhase("connecting");
      setError(null);
      try {
        let h: Household | null = null;
        if (!fresh) {
          try {
            h = JSON.parse(localStorage.getItem(HOME_KEY) ?? "null");
          } catch {}
        }
        if (!h) {
          const r = await fetch("/api/homes", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ place, demo: true }),
          });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error ?? "Couldn't set up the household.");
          h = { id: j.id, place, region: j.region, tariff: j.tariff, mcpUrl: j.mcpUrl, demo: j.demo };
          try {
            localStorage.setItem(HOME_KEY, JSON.stringify(h));
          } catch {}
        }
        const c = await connect(new URL(h.mcpUrl).pathname).catch(async (e) => {
          // The saved household may be gone (e.g. storage reset): start a new one.
          if (fresh) throw e;
          localStorage.removeItem(HOME_KEY);
          return null;
        });
        if (!c) return setup(place, true);
        conn.current = c;
        messages.current = [];
        setHome(h);
        const tide = await callTool(c, "get_tide", {});
        await show("get_tide", {}, tide);
        setPhase("idle");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setPhase("idle");
      }
    },
    [show],
  );

  useEffect(() => {
    setMic(canListen());
    fetch("/api/alexa")
      .then((r) => r.json())
      .then((j) => setEngine(j.engine))
      .catch(() => {});
    setup(DEFAULT_PLACE, false);
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onTheme = () => view.current?.bridge.sendHostContextChange({ theme: theme() });
    mq.addEventListener("change", onTheme);
    return () => {
      mq.removeEventListener("change", onTheme);
      view.current?.dispose();
      stopSpeaking();
    };
  }, [setup]);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: "nearest" });
  }, [log]);

  const ask = useCallback(
    async (utterance: string) => {
      const c = conn.current;
      const text = utterance.trim();
      if (!c || !text) return;
      setError(null);
      stopSpeaking();
      say({ who: "you", text });
      setCaption({ who: "you", text });
      setPhase("thinking");
      // Keep the last ~30 messages, starting at a plain user turn (Bedrock wants that).
      let history: Message[] = [...messages.current, { role: "user" as const, content: [{ text }] }].slice(-30);
      while (history.length > 1 && !(history[0].role === "user" && history[0].content.some((b) => "text" in b))) history = history.slice(1);
      messages.current = history;
      try {
        for (let step = 0; step < 6; step++) {
          const r = await fetch("/api/alexa", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ messages: messages.current, tools: specsOf(c), timeZone: tz, place: home?.place }),
          });
          const turn = (await r.json()) as TurnResponse & { error?: string };
          if (!r.ok) throw new Error(turn.error ?? "Alexa didn't answer.");
          if (turn.note) say({ who: "note", text: turn.note });
          setEngine(turn.engine);
          messages.current = [...messages.current, turn.message];
          if (turn.stop === "tool_use") {
            const results: Message["content"] = [];
            for (const b of turn.message.content) {
              if (!("toolUse" in b)) continue;
              const { toolUseId, name, input } = b.toolUse;
              say({ who: "tool", text: toolLine(name, input), engine: turn.engine });
              const res = await callTool(c, name, input);
              const texts = res.content.filter((x): x is { type: "text"; text: string } => x.type === "text").map((x) => ({ text: x.text }));
              results.push({ toolResult: { toolUseId, content: texts.length ? texts : [{ text: "Done." }], status: res.isError ? "error" : "success" } });
              if (!res.isError) await show(name, input, res);
            }
            messages.current = [...messages.current, { role: "user", content: results }];
            continue;
          }
          const reply = turn.message.content
            .filter((b): b is { text: string } => "text" in b)
            .map((b) => b.text)
            .join(" ")
            .trim();
          say({ who: "alexa", text: reply, engine: turn.engine });
          setCaption({ who: "alexa", text: reply });
          setPhase("speaking");
          await speak(reply, "en-GB", muted);
          break;
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setPhase("idle");
        setTimeout(() => setCaption((cur) => (cur?.who === "alexa" ? null : cur)), 6000);
      }
    },
    [home?.place, muted, show, tz],
  );

  const talk = useCallback(async () => {
    if (phase === "listening") {
      stopListening.current?.();
      return;
    }
    if (phase !== "idle") return;
    stopSpeaking();
    setError(null);
    setPhase("listening");
    setCaption({ who: "you", text: "" });
    try {
      const l = listen("en-GB", (t) => setCaption({ who: "you", text: t }));
      stopListening.current = l.stop;
      const heard = (await l.done).replace(/^(hey |ok |okay )?alexa[,. ]*/i, "");
      stopListening.current = null;
      if (heard) await ask(heard);
      else {
        setPhase("idle");
        setCaption(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("idle");
      setCaption(null);
    }
  }, [ask, phase]);

  // Space bar (outside text fields) is the push-to-talk button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.code === "Space" && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "BUTTON" && mic) {
        e.preventDefault();
        talk();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mic, talk]);

  const busy = phase === "thinking" || phase === "connecting" || phase === "speaking";

  return (
    <div className={s.wrap}>
      <section className={s.stage} aria-label="Simulated Echo Show">
        <div className={s.device} data-phase={phase}>
          <span className={s.camera} aria-hidden />
          <div className={s.screen}>
            <div ref={screen} className={s.view} />
            {phase === "connecting" && <p className={s.boot}>Connecting to Lowtide…</p>}
            {caption && (caption.text || phase === "listening") && (
              <p className={s.caption} data-who={caption.who} aria-live="polite">
                {caption.who === "you" ? (caption.text ? `“${caption.text}”` : "Listening…") : caption.text}
              </p>
            )}
            <span className={s.lightbar} aria-hidden />
          </div>
        </div>
        <div className={s.controls}>
          <button
            type="button"
            className={s.talk}
            data-active={phase === "listening"}
            onClick={talk}
            disabled={!mic || busy}
            title={mic ? "Talk to Alexa (space bar)" : "Your browser can't listen; type below instead"}
          >
            <MicIcon />
            {phase === "listening" ? "Listening… tap to stop" : phase === "thinking" ? "Thinking…" : phase === "speaking" ? "Speaking…" : "Talk to Alexa"}
          </button>
          <form
            className={s.typed}
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy && typed.trim()) {
                ask(typed);
                setTyped("");
              }
            }}
          >
            <label className={s.srOnly} htmlFor="say">
              Type what you would say
            </label>
            <input id="say" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Or type what you'd say" autoComplete="off" />
            <button type="submit" disabled={busy || !typed.trim()}>
              Say it
            </button>
          </form>
          <button type="button" className={s.mute} onClick={() => setMuted((m) => !m)} aria-pressed={muted}>
            {muted ? "Voice off" : "Voice on"}
          </button>
        </div>
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
      </section>

      <aside className={s.side}>
        <div className={s.block}>
          <h2>Try saying</h2>
          <ul className={s.suggest}>
            {SUGGESTIONS.map((q) => (
              <li key={q}>
                <button type="button" onClick={() => !busy && ask(q)} disabled={busy}>
                  {q}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className={s.block}>
          <h2>Conversation</h2>
          {log.length === 0 ? (
            <p className={s.muted}>Your requests, Alexa&apos;s replies and each Lowtide tool call appear here.</p>
          ) : (
            <ol className={s.log}>
              {log.map((l, i) => (
                <li key={i} data-who={l.who}>
                  {l.who === "tool" ? <code>{l.text}</code> : l.text}
                </li>
              ))}
              <li ref={logEnd} aria-hidden className={s.end} />
            </ol>
          )}
          <p className={s.engine}>
            {engine === "bedrock"
              ? "Understanding: Claude Haiku 4.5 on Amazon Bedrock"
              : engine === "fallback"
                ? "Understanding: Lowtide's built-in phrase router"
                : " "}
          </p>
        </div>

        <div className={s.block}>
          <h2>Household</h2>
          {home ? (
            <>
              <p className={s.home}>
                <strong>{home.place}</strong> · {home.region} · {home.tariff}
              </p>
              {home.demo && <p className={s.muted}>Demo household: two weeks of sample runs, priced with the real published rates for those nights.</p>}
              {editing ? (
                <form
                  className={s.typed}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (placeInput.trim()) {
                      setEditing(false);
                      setup(placeInput.trim(), true);
                    }
                  }}
                >
                  <label className={s.srOnly} htmlFor="place">
                    Postcode or city
                  </label>
                  <input id="place" value={placeInput} onChange={(e) => setPlaceInput(e.target.value)} placeholder="UK postcode, Chicago or Germany" autoFocus />
                  <button type="submit">Move</button>
                </form>
              ) : (
                <button type="button" className={s.link} onClick={() => setEditing(true)}>
                  Change location
                </button>
              )}
              <p className={s.mcp}>
                This household&apos;s MCP endpoint:
                <code>{home.mcpUrl}</code>
                <button
                  type="button"
                  className={s.link}
                  onClick={() => {
                    navigator.clipboard?.writeText(home.mcpUrl).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1800);
                    });
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </p>
            </>
          ) : (
            <p className={s.muted}>Setting up…</p>
          )}
        </div>
      </aside>
    </div>
  );
}

function guessCountry(region: string): "GB" | "US" | "DE" {
  if (/illinois|comed/i.test(region)) return "US";
  if (/germany/i.test(region)) return "DE";
  return "GB";
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z" fill="currentColor" />
    </svg>
  );
}
