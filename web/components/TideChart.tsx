"use client";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import s from "./tide.module.css";

/**
 * Tonight as a tide: the next 24 hours of half-hourly prices drawn as a moonlit water surface. The water stands
 * high when power is dear and falls to low tide when it is cheap. Where tomorrow isn't published yet, earlier
 * today's price for the same half hour is drawn as a faint dotted line, never as water. Point anywhere to read
 * a half hour: by mouse, by finger (a tap stays put), or with the arrow keys once the tide has focus. SVG, rendered
 * on the server.
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
    const ghost = lastLive < 47 && ghostPts.length > 1 ? smooth(ghostPts) : "";
    let lowI = -1;
    cells.forEach((c, i) => {
      if (c.live != null && (lowI < 0 || c.live < cells[lowI].live!)) lowI = i;
    });
    // Every 2 hours on a wide tide (every 4 on phones, by CSS), every 6 on a compact one; none where "now" sits.
    const ticks = cells
      .map((c, i) => ({ i, h: hourOf(c.start, tz), min: new Date(c.start).getUTCMinutes() }))
      .filter((t) => t.min === 0 && t.h % (compact ? 6 : 2) === 0 && x(t.i) / W > (compact ? 0.1 : 0.05) && t.i < 46)
      .map((t) => ({ ...t, minor: !compact && t.h % 4 !== 0 }));
    return { cells, x, y, line, area, ghost, lastLive, lowI, ticks, first, lo, hi };
  }, [slots, past, now, tz, H, TOP, BOT, compact]);

  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const read = (e: PointerEvent<SVGSVGElement>) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || !r.width) return;
    setHover(Math.max(0, Math.min(47, Math.round(((e.clientX - r.left) / r.width) * 47))));
    if (timer.current) clearTimeout(timer.current);
    // A tapped reading stays until the next tap, or for a few seconds.
    if (e.pointerType === "touch") timer.current = setTimeout(() => setHover(null), 4000);
  };
  const step = (e: KeyboardEvent<HTMLElement>) => {
    const cur = hover ?? Math.max(0, model.lowI);
    const to: Record<string, number> = { ArrowLeft: cur - 1, ArrowRight: cur + 1, Home: 0, End: 47, PageUp: cur - 8, PageDown: cur + 8 };
    if (e.key === "Escape") return setHover(null);
    if (!(e.key in to)) return;
    e.preventDefault();
    setHover(Math.max(0, Math.min(47, to[e.key])));
  };
  const runX = run && run.end > now ? [model.x(Math.max(0, (Math.max(run.start, now) - model.first) / 1800_000)), model.x(Math.min(47, (run.end - model.first) / 1800_000))] : null;
  const h = hover != null ? model.cells[hover] : null;
  const hp = h ? (h.live ?? h.before) : null;
  const tipX = hover != null ? model.x(hover) / W : 0;
  const reading = h && hp != null ? `${hhmm(h.start, tz)}, ${hp.toFixed(1)}${u} per kWh${h.live == null ? ", earlier today's price" : ""}` : "";

  return (
    <figure
      className={`${s.tide} ${compact ? s.compact : ""}`}
      aria-label={label}
      aria-describedby={`k${uid}`}
      role="group"
      tabIndex={0}
      onKeyDown={step}
      onFocus={(e) => e.target === e.currentTarget && hover == null && setHover(Math.max(0, model.lowI))}
      onBlur={() => setHover(null)}
    >
      <span id={`k${uid}`} className="srOnly">
        Left and right arrows read each half hour; Home and End jump to the ends.
      </span>
      <p className="srOnly" aria-live="polite">
        {reading}
      </p>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className={s.svg}
        aria-hidden
        onPointerDown={read}
        onPointerMove={read}
        onPointerLeave={(e) => e.pointerType !== "touch" && setHover(null)}
      >
        <defs>
          <linearGradient id={`w${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2f679a" stopOpacity="0.95" />
            <stop offset="0.55" stopColor="#123257" stopOpacity="0.9" />
            <stop offset="1" stopColor="#071224" stopOpacity="1" />
          </linearGradient>
          <linearGradient id={`b${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8fd6ff" stopOpacity="0.02" />
            <stop offset="0.5" stopColor="#8fd6ff" stopOpacity="0.12" />
            <stop offset="1" stopColor="#8fd6ff" stopOpacity="0.3" />
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
        {runX && <line x1={runX[0]} x2={runX[0]} y1={TOP - 10} y2={H} className={s.runEdge} vectorEffect="non-scaling-stroke" />}
        {runX && <line x1={runX[1]} x2={runX[1]} y1={TOP - 10} y2={H} className={s.runEdge} vectorEffect="non-scaling-stroke" />}
        {/* now */}
        <line x1={0} x2={0} y1={TOP - 14} y2={H} className={s.now} vectorEffect="non-scaling-stroke" />
        {hover != null && hp != null && <line x1={model.x(hover)} x2={model.x(hover)} y1={0} y2={H} className={s.cursor} vectorEffect="non-scaling-stroke" />}
      </svg>

      {/* HTML overlays keep their proportions while the water stretches. */}
      {hover != null && hp != null && h && (
        <div className={s.tip} data-edge={tipX < 0.1 ? "start" : tipX > 0.9 ? "end" : undefined} style={{ left: `${tipX * 100}%`, top: `calc(var(--h) * ${model.y(hp) / H})` }}>
          <b>{hhmm(h.start, tz)}</b> {hp.toFixed(1)}
          {u}/kWh{h.live == null ? " earlier today" : ""}
        </div>
      )}
      {!compact && model.lowI >= 0 && hover == null && (
        <div className={s.low} style={{ left: `${(model.x(model.lowI) / W) * 100}%`, top: `calc(var(--h) * ${model.y(model.cells[model.lowI].live!) / H})` }}>
          <span>Low tide</span>
          <b className="num">
            {hhmm(model.cells[model.lowI].start, tz)}, {model.cells[model.lowI].live!.toFixed(1)}
            {u}
          </b>
        </div>
      )}
      {!compact && runX && run && (
        <div className={s.runTag} style={{ left: `${(runX[0] / W) * 100}%`, width: `${((runX[1] - runX[0]) / W) * 100}%` }}>
          <span>{run.label}</span>
        </div>
      )}
      {model.lowI >= 0 && (
        <span
          className={s.glint}
          aria-hidden
          style={{ left: `${(model.x(model.lowI) / W) * 100}%`, top: `calc(var(--h) * ${model.y(model.cells[model.lowI].live!) / H})` }}
        />
      )}
      {model.lastLive < 47 && model.lastLive >= 0 && (
        <div className={s.unpub} style={{ left: `${(model.x(model.lastLive) / W) * 100}%` }}>
          <span>
            {model.ghost
              ? compact
                ? "Earlier today"
                : "Tomorrow's prices aren't out yet: earlier today, dotted"
              : compact
                ? "Not published yet"
                : "Prices after this aren't published yet"}
          </span>
        </div>
      )}
      <div className={s.axis} aria-hidden>
        <span className={s.nowTag} style={{ left: 0 }}>
          now
        </span>
        {model.ticks.map((t) => (
          <span key={t.i} className={t.minor ? s.minor : undefined} style={{ left: `${(model.x(t.i) / W) * 100}%` }}>
            {String(t.h).padStart(2, "0")}:00
          </span>
        ))}
      </div>
    </figure>
  );
}
