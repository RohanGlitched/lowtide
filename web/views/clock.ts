/**
 * The day, from above: the next 24 hours as a ring of 48 fins on a 24-hour dial (midnight at the top).
 * Fin length is price; the cheapest quarter is cobalt, the dearest quarter graphite (or white on a dark
 * screen); a pin marks now; planned runs sit on the rim; the centre states the answer.
 * The flat companion of the 3D object on the website. Pure SVG, shared by the MCP App view and the site.
 */
export interface ClockSlot {
  s: number;
  e: number;
  p: number;
  c: number | null;
}
export interface ClockBerth {
  start: number;
  end: number;
  label: string;
  state: "best" | "now" | "planned" | "done" | "alt";
}
export interface ClockData {
  slots: ClockSlot[];
  now: number;
  berths: ClockBerth[];
  unit: "p" | "¢" | "ct";
  timeZone: string;
  centre?: { time: number; above: string; below: string } | null;
}

const NS = "http://www.w3.org/2000/svg";

const THEMES = {
  light: { cheap: "#2340ff", mid: "#a9afb8", dear: "#16181b", ring: "#d5d9de", text: "#16181b", muted: "#5d636b", pin: "#16181b", face: "#f6f7f9" },
  dark: { cheap: "#5b73ff", mid: "#7d848e", dear: "#e9ebee", ring: "#2c3036", text: "#f6f7f9", muted: "#9aa1ab", pin: "#ffffff", face: "#1d2024" },
};
export type ClockTheme = keyof typeof THEMES;

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  parent?.appendChild(n);
  return n;
}

function minuteOfDay(t: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t));
  return Number(parts.find((p) => p.type === "hour")?.value) * 60 + Number(parts.find((p) => p.type === "minute")?.value);
}
export function hhmm(t: number, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
}

const angleOf = (min: number) => (min / 1440) * Math.PI * 2 - Math.PI / 2;
const pt = (cx: number, cy: number, r: number, a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];

function arc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const [x0, y0] = pt(cx, cy, r, a0);
  const [x1, y1] = pt(cx, cy, r, a1);
  return `M${x0.toFixed(2)},${y0.toFixed(2)}A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

/** Draws the dial into `host` at `size` px square. `animate` grows the fins once, around from now. */
export function drawClock(
  host: Element,
  d: ClockData,
  opts: { size: number; animate?: boolean; labels?: boolean; minimal?: boolean; theme?: ClockTheme },
) {
  host.replaceChildren();
  const T = THEMES[opts.theme ?? "light"];
  const S = Math.max(140, Math.round(opts.size));
  const svg = el("svg", { viewBox: `0 0 ${S} ${S}`, width: S, height: S, class: "lt-clock", role: "img" });
  const cx = S / 2;
  const cy = S / 2;
  const labels = opts.labels !== false && !opts.minimal;
  const R = S * (labels ? 0.345 : 0.47);
  const r0 = S * (opts.minimal ? 0.26 : 0.27);
  const tz = d.timeZone;
  const now = d.now;
  const nowMin = minuteOfDay(now, tz);
  const first = Math.floor(now / 1800_000) * 1800_000;
  const horizon = first + 24 * 3600_000;
  const slots = d.slots.filter((s) => s.e > first && s.s < horizon);
  const prices = slots.map((s) => s.p);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const span = Math.max(0.01, hi - lo);
  const sorted = [...prices].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)] ?? lo;
  const q3 = sorted[Math.floor(sorted.length * 0.75)] ?? hi;
  const highlight = d.berths.find((b) => b.state === "best") ?? null;

  const title = el("title", {}, svg);
  const cheapest = slots.reduce<ClockSlot | null>((a, s) => (!a || s.p < a.p ? s : a), null);
  title.textContent = cheapest ? `The next 24 hours of prices around a 24-hour dial. Cheapest at ${hhmm(cheapest.s, tz)}.` : "Prices around the clock.";

  // Dial: a faint ring at the fins' base and an hour scale outside.
  el("circle", { cx, cy, r: r0 - S * 0.012, fill: "none", stroke: T.ring, "stroke-width": 1 }, svg);
  const ticks = el("g", {}, svg);
  for (let h = 0; h < 24; h++) {
    const a = angleOf(h * 60);
    const major = h % 6 === 0;
    const [x0, y0] = pt(cx, cy, R + S * 0.018, a);
    const [x1, y1] = pt(cx, cy, R + S * (major ? 0.045 : 0.03), a);
    el("line", { x1: x0, y1: y0, x2: x1, y2: y1, stroke: major ? T.muted : T.ring, "stroke-width": major ? 1.5 : 1 }, ticks);
    // No label where the now hand points: the hand's dot says the time instead.
    const nearNow = Math.min(Math.abs(nowMin - h * 60), 1440 - Math.abs(nowMin - h * 60)) < 28;
    if (labels && major && !nearNow) {
      // Labels sit clear of the ticks whatever the size: the font has a floor, so the radius grows with it.
      const fs = Math.max(10, S * 0.03);
      const [lx, ly] = pt(cx, cy, Math.min(S / 2 - fs * 1.7, R + S * 0.05 + fs * 1.7), a);
      const t = el("text", { x: lx, y: ly, "text-anchor": "middle", "dominant-baseline": "central", fill: T.muted, class: "lt-hour", "font-size": fs }, ticks);
      t.textContent = `${String(h).padStart(2, "0")}:00`;
    }
  }

  // Fins.
  const fins = el("g", {}, svg);
  const shapes: { line: SVGLineElement; a: number; r: number; delay: number }[] = [];
  const finW = Math.max(2, ((2 * Math.PI * ((r0 + R) / 2)) / 48) * 0.55);
  for (let i = 0; i < 48; i++) {
    const start = first + i * 1800_000;
    const slot = slots.find((x) => x.s <= start + 900_000 && start + 900_000 < x.e);
    const a = angleOf(minuteOfDay(start, tz) + 15);
    const k = slot ? (slot.p - lo) / span : 0;
    const r = slot ? r0 + S * 0.02 + k * (R - r0 - S * 0.02) : r0 + S * 0.012;
    let colour = T.mid;
    if (!slot) colour = T.ring;
    else if (highlight) colour = start + 900_000 >= highlight.start && start + 900_000 < highlight.end ? T.cheap : slot.p >= q3 ? T.dear : T.mid;
    else colour = slot.p <= q1 ? T.cheap : slot.p >= q3 ? T.dear : T.mid;
    const [x0, y0] = pt(cx, cy, r0, a);
    const [x1, y1] = pt(cx, cy, r, a);
    const line = el("line", { x1: x0, y1: y0, x2: x1, y2: y1, stroke: colour, "stroke-width": finW, "stroke-linecap": "round" }, fins);
    if (slot) {
      const tt = el("title", {}, line);
      tt.textContent = `${hhmm(start, tz)}: ${slot.p.toFixed(1)}${d.unit === "ct" ? " ct" : d.unit}/kWh`;
    }
    shapes.push({ line, a, r, delay: (i / 48) * 0.6 });
  }

  // Planned runs on the rim.
  for (const b of d.berths) {
    const from = Math.max(b.start, first);
    if (b.end <= from) continue;
    const m0 = minuteOfDay(from, tz);
    const a0 = angleOf(m0);
    const a1 = angleOf(m0 + (b.end - from) / 60_000);
    const best = b.state === "best";
    el("path", { d: arc(cx, cy, R + S * 0.03, a0, a1), stroke: best ? T.cheap : T.muted, "stroke-width": S * (best ? 0.014 : 0.008), "stroke-linecap": "round", fill: "none", ...(b.state === "alt" ? { "stroke-dasharray": `${S * 0.01} ${S * 0.012}` } : {}) }, svg);
  }

  // Now: a pin from the hub through the scale.
  {
    const a = angleOf(minuteOfDay(now, tz));
    const [x0, y0] = pt(cx, cy, r0 - S * 0.04, a);
    const [x1, y1] = pt(cx, cy, R + S * 0.05, a);
    el("line", { x1: x0, y1: y0, x2: x1, y2: y1, stroke: T.pin, "stroke-width": Math.max(1.5, S * 0.005), "stroke-linecap": "round" }, svg);
    el("circle", { cx: x1, cy: y1, r: Math.max(2.5, S * 0.011), fill: T.cheap }, svg);
  }

  // The answer.
  if (d.centre) {
    const big = r0 * (opts.minimal ? 0.62 : 0.5);
    if (!opts.minimal) {
      const above = el("text", { x: cx, y: cy - big * 0.78, "text-anchor": "middle", fill: T.muted, class: "lt-cap", "font-size": Math.max(10, r0 * 0.13) }, svg);
      above.textContent = d.centre.above;
    }
    const time = el("text", { x: cx, y: cy + big * 0.34, "text-anchor": "middle", fill: T.text, class: "lt-time", "font-size": big }, svg);
    time.textContent = hhmm(d.centre.time, tz);
    if (!opts.minimal) {
      const below = el("text", { x: cx, y: cy + big * 0.98, "text-anchor": "middle", fill: T.muted, class: "lt-cap", "font-size": Math.max(10, r0 * 0.13) }, svg);
      below.textContent = d.centre.below;
    }
  }

  host.appendChild(svg);

  const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (opts.animate && !reduce) {
    const t0 = performance.now();
    for (const sh of shapes) {
      const [x, y] = pt(cx, cy, r0 + 0.5, sh.a);
      sh.line.setAttribute("x2", String(x));
      sh.line.setAttribute("y2", String(y));
    }
    const frame = (n: number) => {
      const e = Math.max(0, (n - t0) / 1000);
      let running = false;
      for (const sh of shapes) {
        const k = Math.max(0, Math.min(1, (e - sh.delay) / 0.6));
        if (k < 1) running = true;
        const ease = 1 - Math.pow(1 - k, 3);
        const [x, y] = pt(cx, cy, r0 + 0.5 + (sh.r - r0 - 0.5) * ease, sh.a);
        sh.line.setAttribute("x2", x.toFixed(2));
        sh.line.setAttribute("y2", y.toFixed(2));
      }
      if (running) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
  return svg;
}
