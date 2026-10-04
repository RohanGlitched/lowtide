/**
 * The tidal curve: price drawn as a water level over the coming day, with soundings, low and high water,
 * the "now" line and appliance berths. Pure DOM/SVG so it renders in any MCP Apps host.
 * Shared by the MCP view and the website (which imports it directly).
 */
export interface ChartSlot {
  s: number;
  e: number;
  p: number;
  c: number | null;
}
export interface ChartRun {
  start: number;
  end: number;
  avgPrice: number;
}
export interface ChartBerth {
  start: number;
  end: number;
  label: string;
  state: "best" | "now" | "planned" | "done" | "alt";
}
export interface ChartData {
  slots: ChartSlot[];
  now: number;
  marks: { low: ChartRun | null; high: ChartRun | null };
  berths: ChartBerth[];
  unit: "p" | "¢" | "ct";
  timeZone: string;
}

const NS = "http://www.w3.org/2000/svg";

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  parent?.appendChild(n);
  return n;
}

function hm(t: number, tz: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
}
function hourOf(t: number, tz: string) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(new Date(t)));
}
function weekday(t: number, tz: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short" }).format(new Date(t));
}
function priceLabel(p: number, unit: string) {
  const u = unit === "ct" ? " ct" : unit;
  const v = Math.abs(p) >= 10 ? Math.round(p).toString() : p.toFixed(1);
  return `${p < 0 ? "−" : ""}${v.replace("-", "")}${u}`;
}

/** Draws into `host` (replacing its contents). `animate` reveals the water left to right once. */
export function drawTide(host: HTMLElement, d: ChartData, opts: { animate?: boolean; compact?: boolean; height?: number } = {}) {
  host.replaceChildren();
  if (!d.slots.length) return;
  const W = Math.max(280, Math.round(host.clientWidth || 640));
  const compact = opts.compact ?? W < 560;
  const H = opts.height
    ? Math.round(Math.max(150, opts.height))
    : Math.round(Math.min(420, Math.max(190, W * (compact ? 0.52 : 0.36))));
  const pad = { l: 8, r: 8, t: compact ? 46 : 58, b: 30 };
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "tide", role: "img" });
  const t0 = Math.max(d.slots[0].s, Math.min(d.now, d.slots[d.slots.length - 1].s));
  const t1 = d.slots[d.slots.length - 1].e;
  const slots = d.slots.filter((s) => s.e > t0);
  const prices = slots.map((s) => s.p);
  const lo = Math.min(0, ...prices);
  const hi = Math.max(...prices) * 1.08 + 0.01;
  const x = (t: number) => pad.l + ((t - t0) / (t1 - t0)) * (W - pad.l - pad.r);
  const y = (p: number) => pad.t + (1 - (p - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const base = H - pad.b;

  const title = el("title", {}, svg);
  const low = d.marks.low;
  title.textContent = low
    ? `Electricity price over the next ${Math.round((t1 - t0) / 3600_000)} hours. Lowest around ${hm(low.start, d.timeZone)} at ${priceLabel(low.avgPrice, d.unit)} per kWh.`
    : "Electricity price over the coming hours.";

  const defs = el("defs", {}, svg);
  const grad = el("linearGradient", { id: "water", x1: 0, x2: 0, y1: 0, y2: 1 }, defs);
  el("stop", { offset: "0%", "stop-color": "var(--shoal)", "stop-opacity": 1 }, grad);
  el("stop", { offset: "100%", "stop-color": "var(--deep)", "stop-opacity": 0.55 }, grad);
  const clip = el("clipPath", { id: "reveal" }, defs);
  const clipRect = el("rect", { x: 0, y: 0, width: opts.animate ? 0 : W, height: H }, clip);

  // Day/night bands (local 21:00–06:00) as faint ruled hatching: when most cheap water sits.
  const g = el("g", {}, svg);
  for (let t = Math.floor(t0 / 3600_000) * 3600_000; t < t1; t += 3600_000) {
    const h = hourOf(t, d.timeZone);
    if (h >= 21 || h < 6) el("rect", { x: x(Math.max(t, t0)), y: pad.t - 6, width: Math.max(0, x(Math.min(t + 3600_000, t1)) - x(Math.max(t, t0))), height: base - pad.t + 6, class: "night" }, g);
  }

  // The water: a stepped surface (prices hold for each slot), filled to the floor.
  let path = `M ${x(t0)} ${base}`;
  for (const s of slots) {
    const a = x(Math.max(s.s, t0));
    const b = x(s.e);
    path += ` L ${a} ${y(s.p)} L ${b} ${y(s.p)}`;
  }
  path += ` L ${x(t1)} ${base} Z`;
  const water = el("g", { "clip-path": "url(#reveal)" }, svg);
  el("path", { d: path, fill: "url(#water)", class: "water" }, water);
  let surface = "";
  slots.forEach((s, i) => {
    const a = x(Math.max(s.s, t0));
    surface += `${i ? " L" : "M"} ${a} ${y(s.p)} L ${x(s.e)} ${y(s.p)}`;
  });
  el("path", { d: surface, class: "surface" }, water);
  if (lo < 0) {
    el("line", { x1: pad.l, x2: W - pad.r, y1: y(0), y2: y(0), class: "datum" }, water);
    const z = el("text", { x: W - pad.r - 2, y: y(0) - 4, class: "sounding", "text-anchor": "end" }, water);
    z.textContent = `0${d.unit === "ct" ? " ct" : d.unit}`;
  }

  // Carbon, where published: a dotted contour on its own scale.
  const withC = slots.filter((s) => s.c != null);
  if (withC.length > slots.length * 0.6) {
    const cs = withC.map((s) => s.c!);
    const cmin = Math.min(...cs);
    const cmax = Math.max(...cs) + 1;
    const cy = (c: number) => pad.t + 10 + (1 - (c - cmin) / (cmax - cmin)) * (base - pad.t - 30);
    let cp = "";
    withC.forEach((s, i) => {
      cp += `${i ? " L" : "M"} ${x((Math.max(s.s, t0) + s.e) / 2)} ${cy(s.c!)}`;
    });
    el("path", { d: cp, class: "carbon" }, water);
  }

  // Soundings: the price written along the curve every few hours, in italic, like depths on a chart.
  const every = compact ? 4 : 3;
  let lastX = -999;
  for (const s of slots) {
    const h = hourOf(s.s, d.timeZone);
    const minute = new Date(s.s).getUTCMinutes();
    if (h % every !== 0 || minute !== 0 || s.s < t0) continue;
    const px = x(s.s) + 4;
    if (px - lastX < 44 || px > W - 40) continue;
    lastX = px;
    const label = el("text", { x: px, y: Math.min(base - 8, y(s.p) + 18), class: "sounding" }, water);
    label.textContent = priceLabel(s.p, d.unit);
  }

  // Low and high water labels.
  const mark = (r: ChartRun | null, kind: "LW" | "HW") => {
    if (!r) return;
    const mx = x((r.start + Math.min(r.end, t1)) / 2);
    const my = y(r.avgPrice);
    const above = kind === "HW";
    el("line", { x1: mx, x2: mx, y1: my, y2: above ? my - 12 : my + 12, class: "tick" }, water);
    const txt = el("text", { x: Math.min(W - 70, Math.max(70, mx)), y: above ? my - 17 : Math.min(base - 4, my + 27), class: `mark ${kind}`, "text-anchor": "middle" }, water);
    txt.textContent = `${kind} ${hm(r.start, d.timeZone)} · ${priceLabel(r.avgPrice, d.unit)}`;
  };
  mark(d.marks.high, "HW");
  mark(d.marks.low, "LW");

  // Berths: brackets above the water for planned runs.
  const berthRow = (i: number) => 14 + i * (compact ? 15 : 17);
  const placed: { a: number; z: number; row: number }[] = [];
  d.berths
    .slice()
    .sort((a, b) => (a.state === "best" ? -1 : b.state === "best" ? 1 : a.start - b.start))
    .forEach((b) => {
      const a = x(Math.max(b.start, t0));
      const z = x(Math.min(b.end, t1));
      if (z <= a) return;
      // Lowest row whose brackets (and their labels, ~150px) don't collide with this one.
      let row = 0;
      while (placed.some((p) => p.row === row && a < Math.max(p.z, p.a + 150) && p.a < Math.max(z, a + 150))) row++;
      placed.push({ a, z, row });
      const yy = berthRow(Math.min(row, 2));
      const gB = el("g", { class: `berth ${b.state}` }, svg);
      el("path", { d: `M ${a} ${yy + 6} L ${a} ${yy} L ${z} ${yy} L ${z} ${yy + 6}`, class: "bracket" }, gB);
      el("rect", { x: a, y: yy + 7, width: z - a, height: base - yy - 7, class: "berth-fill" }, gB);
      const lbl = el("text", { x: Math.min(a + 4, W - 120), y: yy - 4, class: "berth-label" }, gB);
      lbl.textContent = `${b.label} ${hm(b.start, d.timeZone)}–${hm(b.end, d.timeZone)}`;
    });

  // Now.
  if (d.now >= t0 && d.now <= t1) {
    const nx = x(d.now);
    el("line", { x1: nx, x2: nx, y1: pad.t - 10, y2: base, class: "now" }, svg);
    const nt = el("text", { x: nx + 4, y: base - 6, class: "now-label" }, svg);
    nt.textContent = "now";
  }

  // Time axis: every 3 h, with the weekday at local midnight.
  const axis = el("g", { class: "axis" }, svg);
  el("line", { x1: pad.l, x2: W - pad.r, y1: base, y2: base, class: "floor" }, axis);
  const step = compact ? 6 : 3;
  for (let t = Math.ceil(t0 / 3600_000) * 3600_000; t <= t1; t += 3600_000) {
    const h = hourOf(t, d.timeZone);
    if (h % step !== 0) continue;
    const tx = x(t);
    if (tx < 18 || tx > W - 18) continue;
    el("line", { x1: tx, x2: tx, y1: base, y2: base + 5, class: "floor" }, axis);
    const lab = el("text", { x: tx, y: base + 19, "text-anchor": "middle", class: h === 0 ? "axis-day" : "" }, axis);
    lab.textContent = h === 0 ? weekday(t, d.timeZone) : `${String(h).padStart(2, "0")}:00`;
  }

  host.appendChild(svg);
  if (opts.animate && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const startAt = performance.now();
    const dur = 1400;
    const tick = (n: number) => {
      const k = Math.max(0, Math.min(1, (n - startAt) / dur));
      clipRect.setAttribute("width", String(W * (1 - Math.pow(1 - k, 3))));
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  } else {
    clipRect.setAttribute("width", String(W));
  }
}
