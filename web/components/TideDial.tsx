"use client";
import { useMemo, useState } from "react";
import s from "./tidedial.module.css";

/**
 * The day, machined: the next 24 hours of half-hourly prices as 48 fins on a turned aluminium dial
 * (midnight at the top, the same dial the Echo Show and the MCP App view draw). Fin length is price; the
 * cheapest quarter is cobalt, the dearest graphite. Where tomorrow isn't published yet, the same time of day
 * earlier today stands in, frosted. A pin marks now; a cobalt arc on the rim marks a planned run. Point at
 * a fin (or tab to it) and the centre reads it out. Pure SVG: drawn on the server, no loading.
 */
export interface DialSlot {
  s: number;
  e: number;
  p: number;
}
export interface TideDialProps {
  slots: DialSlot[];
  past?: DialSlot[];
  now: number;
  timeZone: string;
  unit: "p" | "¢" | "ct";
  run?: { start: number; end: number; label: string } | null;
  label: string;
  /** What the centre says before anyone points at a fin. */
  rest: { above: string; big: string; below: string };
  size?: "hero" | "card";
}

const C = 500;
const R0 = 238; // fins start here
const R_MIN = 268;
const R_MAX = 432;
const FACE = 462;
const HUB = 214;

const angleOf = (min: number) => (min / 1440) * 360; // degrees, 0 = midnight at the top
const rad = (deg: number) => ((deg - 90) * Math.PI) / 180;
// Rounded, so the server's and the browser's floating point agree when the page hydrates.
const r2 = (n: number) => Math.round(n * 100) / 100;
const pt = (r: number, deg: number) => [r2(C + r * Math.cos(rad(deg))), r2(C + r * Math.sin(rad(deg)))] as const;

function partsOf(t: number, tz: string) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t));
  return Number(p.find((x) => x.type === "hour")?.value) * 60 + Number(p.find((x) => x.type === "minute")?.value);
}
function hhmm(t: number, tz: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
}
function arc(r: number, a0: number, a1: number) {
  const [x0, y0] = pt(r, a0);
  const [x1, y1] = pt(r, a1);
  return `M${x0.toFixed(1)},${y0.toFixed(1)}A${r},${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(1)},${y1.toFixed(1)}`;
}

export default function TideDial({ slots, past = [], now, timeZone: tz, unit, run, label, rest, size = "hero" }: TideDialProps) {
  const u = unit === "ct" ? " ct" : unit;
  const fins = useMemo(() => {
    const first = Math.floor(now / 1800_000) * 1800_000;
    const raw = Array.from({ length: 48 }, (_, i) => {
      const start = first + i * 1800_000;
      const mid = start + 900_000;
      const live = slots.find((x) => x.s <= mid && mid < x.e) ?? null;
      const before = live ? null : (past.find((x) => x.s <= mid - 86_400_000 && mid - 86_400_000 < x.e) ?? null);
      const slot = live ?? before;
      return { i, start, price: slot?.p ?? null, earlier: !live && !!before, deg: angleOf(partsOf(start, tz) + 15) };
    });
    const prices = raw.filter((f) => f.price != null).map((f) => f.price!);
    const lo = Math.min(...prices);
    const hi = Math.max(...prices);
    const span = Math.max(0.01, hi - lo);
    const live = raw.filter((f) => f.price != null && !f.earlier).map((f) => f.price!).sort((a, b) => a - b);
    const q1 = live[Math.floor(live.length * 0.25)] ?? lo;
    const q3 = live[Math.floor(live.length * 0.75)] ?? hi;
    return raw.map((f) => {
      const k = f.price == null ? 0 : (f.price - lo) / span;
      const len = f.price == null ? 10 : r2(R_MIN - R0 + k * (R_MAX - R_MIN));
      const tone = f.price == null ? "none" : f.earlier ? "past" : f.price <= q1 ? "cheap" : f.price >= q3 ? "dear" : "mid";
      return { ...f, len, tone };
    });
  }, [slots, past, now, tz]);

  const [hover, setHover] = useState<number | null>(null);

  const finW = r2(((2 * Math.PI * ((R0 + R_MAX) / 2)) / 48) * 0.5);
  const nowDeg = angleOf(partsOf(now, tz));
  const h = hover != null ? fins[hover] : null;
  const readout = h
    ? {
        above: `${hhmm(h.start, tz)} to ${hhmm(h.start + 1800_000, tz)}`,
        big: h.price == null ? "—" : `${h.price.toFixed(1)}${u}`,
        below: h.price == null ? "not published yet" : h.earlier ? "per kWh earlier today" : "per kWh",
      }
    : rest;

  let runArc: string | null = null;
  if (run && run.end > now) {
    const from = Math.max(run.start, now);
    const a0 = angleOf(partsOf(from, tz));
    const a1 = a0 + ((run.end - from) / 60_000 / 1440) * 360;
    runArc = arc(FACE - 10, a0, a1);
  }

  return (
    <figure className={`${s.dial} ${size === "card" ? s.card : ""}`} aria-label={label} role="group">
      <svg viewBox="-70 -70 1140 1140" className={s.svg} onPointerLeave={() => setHover(null)}>
        <defs>
          <radialGradient id="td-face" cx="42%" cy="34%" r="80%">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.55" stopColor="#eef0f3" />
            <stop offset="1" stopColor="#d9dde3" />
          </radialGradient>
          <linearGradient id="td-rim" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.45" stopColor="#c3c9d1" />
            <stop offset="0.7" stopColor="#eef0f3" />
            <stop offset="1" stopColor="#9aa1ab" />
          </linearGradient>
          <radialGradient id="td-hub" cx="40%" cy="30%" r="85%">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="1" stopColor="#e4e7eb" />
          </radialGradient>
          <filter id="td-shadow" x="-20%" y="-20%" width="140%" height="150%">
            <feDropShadow dx="0" dy="26" stdDeviation="28" floodColor="#16181b" floodOpacity="0.16" />
          </filter>
        </defs>

        {/* The turned disc: a bevelled rim around a brushed face, a hub in the middle. */}
        <circle cx={C} cy={C} r={FACE + 22} fill="url(#td-rim)" filter="url(#td-shadow)" />
        <circle cx={C} cy={C} r={FACE + 6} fill="url(#td-face)" />
        <circle cx={C} cy={C} r={FACE + 6} fill="none" stroke="#ffffff" strokeOpacity="0.9" strokeWidth="2" />
        {Array.from({ length: 6 }, (_, i) => (
          <circle key={i} cx={C} cy={C} r={HUB + 40 + i * 38} fill="none" stroke="#16181b" strokeOpacity="0.025" strokeWidth="1" />
        ))}

        {/* Hours: engraved ticks on the rim, numbers outside. */}
        {Array.from({ length: 24 }, (_, hr) => {
          const deg = (hr / 24) * 360;
          const major = hr % 6 === 0;
          const [x0, y0] = pt(FACE - (major ? 26 : 16), deg);
          const [x1, y1] = pt(FACE - 4, deg);
          const [lx, ly] = pt(FACE + 58, deg);
          return (
            <g key={hr}>
              <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={major ? "#5d636b" : "#aab1bb"} strokeWidth={major ? 3 : 1.6} strokeLinecap="round" />
              {major && (
                <text x={lx} y={ly} className={s.hour} textAnchor="middle" dominantBaseline="central">
                  {String(hr).padStart(2, "0")}:00
                </text>
              )}
            </g>
          );
        })}

        {/* A planned run, on the rim. */}
        {runArc && <path d={runArc} className={s.run} />}

        {/* Fins. */}
        <g className={s.fins}>
          {fins.map((f) => (
            <g key={f.i} transform={`rotate(${f.deg.toFixed(2)} ${C} ${C})`}>
              <rect
                x={C - finW / 2}
                y={C - R0 - f.len}
                width={finW}
                height={f.len}
                rx={finW / 2}
                className={`${s.fin} ${s[f.tone]} ${hover === f.i ? s.on : ""}`}
                style={{ animationDelay: `${(f.i / 48) * 520}ms` }}
              />
              {/* A wide invisible hit area, so pointing near a fin is enough. */}
              <rect
                x={C - finW}
                y={C - R_MAX - 20}
                width={finW * 2}
                height={R_MAX + 20 - HUB}
                fill="transparent"
                tabIndex={f.price == null ? -1 : 0}
                onPointerEnter={() => setHover(f.i)}
                onFocus={() => setHover(f.i)}
                onBlur={() => setHover(null)}
                aria-label={f.price == null ? `${hhmm(f.start, tz)}, not published yet` : `${hhmm(f.start, tz)}, ${f.price.toFixed(1)}${u} per kWh${f.earlier ? " earlier today" : ""}`}
              />
            </g>
          ))}
        </g>

        {/* Now: a polished pin from the hub to the rim with a cobalt head. */}
        <g transform={`rotate(${nowDeg.toFixed(2)} ${C} ${C})`} className={s.pin}>
          <line x1={C} y1={C - HUB + 8} x2={C} y2={C - FACE + 2} stroke="#16181b" strokeWidth="4" strokeLinecap="round" />
          <circle cx={C} cy={C - FACE + 2} r="11" fill="#2340ff" stroke="#fff" strokeWidth="4" />
        </g>

        {/* The hub, which reads the dial out. */}
        <circle cx={C} cy={C} r={HUB} fill="url(#td-hub)" />
        <circle cx={C} cy={C} r={HUB} fill="none" stroke="#c9ced6" strokeWidth="2" />
        <circle cx={C} cy={C} r={HUB - 10} fill="none" stroke="#ffffff" strokeWidth="2" />
        <text x={C} y={size === "card" ? C - 92 : C - 70} textAnchor="middle" className={s.above}>
          {readout.above}
        </text>
        <text x={C} y={size === "card" ? C + 50 : C + 34} textAnchor="middle" className={`${s.big} ${h ? "" : s.bigRest}`}>
          {readout.big}
        </text>
        <text x={C} y={size === "card" ? C + 118 : C + 90} textAnchor="middle" className={s.below}>
          {readout.below}
        </text>
      </svg>
    </figure>
  );
}
