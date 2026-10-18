"use client";
import { useId, useMemo, useState } from "react";
import s from "./tide.module.css";

/**
 * Tonight as a tide: the next 24 hours of half-hourly prices drawn as a moonlit water surface. The water stands
 * high when power is dear and falls to low tide when it is cheap. Where tomorrow isn't published yet, earlier
 * today's price for the same half hour is drawn as a faint dotted line, never as water. Point anywhere to read
 * a half hour. SVG, rendered on the server.
 */
export interface TideSlot {
  s: number;
  e: number;
  p: number;
}
export interface TideChartProps {
  slots: TideSlot[];
  past?: TideSlot[];
  now: number;
  timeZone: string;
  unit: "p" | "¢" | "ct";
  run?: { start: number; end: number; label: string } | null;
  label: string;
  height?: number;
  compact?: boolean;
}

const W = 1200;
const r2 = (n: number) => Math.round(n * 100) / 100;

function hhmm(t: number, tz: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
}
function hourOf(t: number, tz: string) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(new Date(t)));
}

function smooth(pts: [number, number][]) {
  if (!pts.length) return "";
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const xm = r2((pts[i - 1][0] + pts[i][0]) / 2);
    d += ` C${xm},${pts[i - 1][1]} ${xm},${pts[i][1]} ${pts[i][0]},${pts[i][1]}`;
  }
  return d;
}

export default function TideChart({ slots, past = [], now, timeZone: tz, unit, run, label, height = 280, compact = false }: TideChartProps) {
  const H = height;
  const TOP = compact ? 18 : 40;
  const BOT = H - (compact ? 26 : 34);
  const u = unit === "ct" ? " ct" : unit;
  const uid = useId().replace(/:/g, "");

  const model = useMemo(() => {
    const first = Math.floor(now / 1800_000) * 1800_000;
    const cells = Array.from({ length: 48 }, (_, i) => {
      const start = first + i * 1800_000;
      const mid = start + 900_000;
      const live = slots.find((x) => x.s <= mid && mid < x.e) ?? null;
      const before = live ? null : (past.find((x) => x.s <= mid - 86_400_000 && mid - 86_400_000 < x.e) ?? null);
      return { start, live: live?.p ?? null, before: before?.p ?? null };
    });
    const all = cells.flatMap((c) => [c.live, c.before]).filter((p): p is number => p != null);
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const span = Math.max(0.01, hi - lo);
    const x = (i: number) => r2((i / 47) * W);
    // Dear is high water, cheap is low water.
    const y = (p: number) => r2(BOT - ((p - lo) / span) * (BOT - TOP));
    const livePts = cells.map((c, i) => (c.live != null ? ([x(i), y(c.live)] as [number, number]) : null)).filter((p): p is [number, number] => !!p);
    const lastLive = cells.reduce((a, c, i) => (c.live != null ? i : a), -1);
    const ghostPts = cells.map((c, i) => (i >= lastLive && (c.before != null || i === lastLive) ? ([x(i), y(c.live ?? c.before!)] as [number, number]) : null)).filter((p): p is [number, number] => !!p);
    const line = smooth(livePts);
    const area = livePts.length ? `${line} L${livePts[livePts.length - 1][0]},${H} L${livePts[0][0]},${H} Z` : "";
    const ghost = lastLive < 47 ? smooth(ghostPts) : "";
    let lowI = -1;
    cells.forEach((c, i) => {
      if (c.live != null && (lowI < 0 || c.live < cells[lowI].live!)) lowI = i;
    });
    const ticks = cells.map((c, i) => ({ i, h: hourOf(c.start, tz), min: new Date(c.start).getUTCMinutes() })).filter((t) => t.min === 0 && t.h % (compact ? 6 : 4) === 0);
    return { cells, x, y, line, area, ghost, lastLive, lowI, ticks, first };
  }, [slots, past, now, tz, H, TOP, BOT, compact]);

  const [hover, setHover] = useState<number | null>(null);
  const runX = run && run.end > now ? [model.x(Math.max(0, (Math.max(run.start, now) - model.first) / 1800_000)), model.x(Math.min(47, (run.end - model.first) / 1800_000))] : null;
  const h = hover != null ? model.cells[hover] : null;
  const hp = h ? (h.live ?? h.before) : null;

  return (
    <figure className={`${s.tide} ${compact ? s.compact : ""}`} aria-label={label} role="group">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={s.svg} onPointerLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={`w${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2f679a" stopOpacity="0.95" />
            <stop offset="0.55" stopColor="#123257" stopOpacity="0.9" />
            <stop offset="1" stopColor="#071224" stopOpacity="1" />
          </linearGradient>
          <linearGradient id={`b${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8fd6ff" stopOpacity="0" />
            <stop offset="0.6" stopColor="#8fd6ff" stopOpacity="0.06" />
            <stop offset="1" stopColor="#8fd6ff" stopOpacity="0.16" />
          </linearGradient>
          <linearGradient id={`g${uid}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#8fd6ff" stopOpacity="0" />
            <stop offset="0.5" stopColor="#8fd6ff" stopOpacity="0.9" />
            <stop offset="1" stopColor="#8fd6ff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {model.area && <path d={model.area} fill={`url(#w${uid})`} />}
        {runX && <rect x={runX[0]} y={0} width={Math.max(4, runX[1] - runX[0])} height={H} fill={`url(#b${uid})`} />}
        {model.line && <path d={model.line} className={s.line} vectorEffect="non-scaling-stroke" />}
        {model.ghost && <path d={model.ghost} className={s.ghost} vectorEffect="non-scaling-stroke" />}
        {runX && <line x1={runX[0]} x2={runX[1]} y1={BOT + 6} y2={BOT + 6} stroke={`url(#g${uid})`} strokeWidth="3" vectorEffect="non-scaling-stroke" />}
        {/* now */}
        <line x1={0} x2={0} y1={TOP - 14} y2={H} className={s.now} vectorEffect="non-scaling-stroke" />
        {/* hit areas */}
        {model.cells.map((c, i) => (
          <rect key={i} x={model.x(i) - W / 96} y={0} width={W / 48} height={H} fill="transparent" onPointerEnter={() => setHover(i)} />
        ))}
        {hover != null && hp != null && <line x1={model.x(hover)} x2={model.x(hover)} y1={0} y2={H} className={s.cursor} vectorEffect="non-scaling-stroke" />}
      </svg>

      {/* HTML overlays keep their proportions while the water stretches. */}
      {hover != null && hp != null && h && (
        <div className={s.tip} style={{ left: `${(model.x(hover) / W) * 100}%`, top: `${(model.y(hp) / H) * 100}%` }}>
          <b>{hhmm(h.start, tz)}</b> {hp.toFixed(1)}
          {u}/kWh{h.live == null ? " earlier today" : ""}
        </div>
      )}
      {!compact && model.lowI >= 0 && hover == null && (
        <div className={s.low} style={{ left: `${(model.x(model.lowI) / W) * 100}%`, top: `${(model.y(model.cells[model.lowI].live!) / H) * 100}%` }}>
          <span>Low tide</span>
          <b className="num">
            {hhmm(model.cells[model.lowI].start, tz)}, {model.cells[model.lowI].live!.toFixed(1)}
            {u}
          </b>
        </div>
      )}
      {model.lastLive < 47 && model.lastLive >= 0 && (
        <div className={s.unpub} style={{ left: `${(model.x(model.lastLive) / W) * 100}%` }}>
          <span>{compact ? "Earlier today" : "Tomorrow's prices aren't out yet: earlier today, dotted"}</span>
        </div>
      )}
      <div className={s.axis} aria-hidden>
        <span className={s.nowTag} style={{ left: 0 }}>
          now
        </span>
        {model.ticks
          .filter((t) => t.i > 2)
          .map((t) => (
            <span key={t.i} style={{ left: `${(model.x(t.i) / W) * 100}%` }}>
              {String(t.h).padStart(2, "0")}:00
            </span>
          ))}
      </div>
    </figure>
  );
}
