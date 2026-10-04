import { App } from "@modelcontextprotocol/ext-apps";
import { drawClock, type ClockData } from "./clock";

interface ViewData {
  kind: string;
  headline: string;
  sub: string;
  region: { name: string; tariff: string; unit: "p" | "¢" | "ct"; currency: string; timeZone: string; priceNote: string; carbonSource: string | null };
  slots: ClockData["slots"];
  now: number;
  marks: { low: { start: number; end: number; avgPrice: number } | null; high: { start: number; end: number; avgPrice: number } | null };
  berths: ClockData["berths"];
  facts: { label: string; value: string }[];
  mix: { fuel: string; perc: number }[] | null;
}

const root = document.getElementById("root")!;
let last: ViewData | null = null;
let drawn = false;
let theme: "light" | "dark" = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

function text(tag: string, cls: string, s: string) {
  const n = document.createElement(tag);
  n.className = cls;
  n.textContent = s;
  return n;
}

/** What the centre of the dial says for each kind of answer. */
function centreOf(d: ViewData): ClockData["centre"] {
  const best = d.berths.find((b) => b.state === "best");
  if (best) return { time: best.start, above: "start at", below: best.label };
  const planned = d.berths[0];
  if (planned) return { time: planned.start, above: "next run", below: planned.label };
  if (d.marks.low) return { time: d.marks.low.start, above: "cheapest", below: "hour" };
  return null;
}

function render(d: ViewData) {
  last = d;
  root.replaceChildren();
  root.dataset.kind = d.kind;

  const dial = document.createElement("div");
  dial.className = "dial";
  const copy = document.createElement("div");
  copy.className = "copy";
  root.append(dial, copy);

  copy.append(text("h1", "headline", d.headline));
  if (d.sub) copy.append(text("p", "sub", d.sub));
  if (d.facts.length) {
    const dl = document.createElement("dl");
    dl.className = "facts";
    for (const f of d.facts.slice(0, 4)) {
      const div = document.createElement("div");
      div.append(text("dt", "", f.label), text("dd", "", f.value));
      dl.append(div);
    }
    copy.append(dl);
  }
  if (d.mix?.length) {
    copy.append(text("p", "mix", "Grid now: " + d.mix.slice(0, 4).map((m) => `${m.fuel} ${Math.round(m.perc)}%`).join(", ")));
  }
  copy.append(text("p", "source", `${d.region.name}, ${d.region.tariff}. ${d.region.priceNote}`));

  const fit = root.classList.contains("fit");
  const tall = window.innerHeight > window.innerWidth;
  const size = fit
    ? Math.floor(tall ? Math.min(window.innerWidth * 0.86, window.innerHeight * 0.46) : Math.min(window.innerHeight * 0.86, window.innerWidth * 0.46))
    : dial.clientWidth || 300;
  const svgEl = drawClock(
    dial,
    { slots: d.slots, now: d.now, berths: d.berths, unit: d.region.unit, timeZone: d.region.timeZone, centre: centreOf(d) },
    { size, animate: !drawn, theme },
  );
  if (fit) {
    svgEl.style.width = `${size}px`;
    svgEl.style.height = `${size}px`;
  }
  drawn = true;
}

function applyTheme(t?: string) {
  if (t !== "dark" && t !== "light") return;
  theme = t;
  document.documentElement.dataset.theme = t;
  if (last) render(last);
}
function applyMode(mode?: string) {
  const fit = mode === "fullscreen";
  if (fit !== root.classList.contains("fit")) {
    root.classList.toggle("fit", fit);
    if (last) render(last);
  }
}

const app = new App({ name: "Lowtide", version: "1.0.0" });
app.ontoolresult = (params) => {
  const sc = (params as { structuredContent?: unknown }).structuredContent as ViewData | undefined;
  if (sc && Array.isArray(sc.slots)) render(sc);
  else {
    const t = (params as { content?: { type: string; text?: string }[] }).content?.find((c) => c.type === "text")?.text;
    root.replaceChildren(text("p", "error", t ?? "Lowtide couldn't read the prices just now."));
  }
};
app.ontoolinput = () => {
  if (!last) root.replaceChildren(text("p", "loading", "Reading tonight's prices…"));
};
app.ontoolcancelled = (p) => {
  root.replaceChildren(text("p", "error", (p as { reason?: string }).reason ?? "Cancelled."));
};
app.onhostcontextchanged = (ctx) => {
  const c = ctx as { theme?: string; displayMode?: string };
  applyTheme(c.theme);
  if (c.displayMode) applyMode(c.displayMode);
};

// Redraw when the size changes (debounced).
let resizeTimer = 0;
let lastKey = "";
new ResizeObserver(() => {
  const key = `${innerWidth}x${root.classList.contains("fit") ? innerHeight : 0}`;
  if (key === lastKey) return;
  lastKey = key;
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => last && render(last), 120);
}).observe(document.documentElement);

app.connect().then(() => {
  const c = app.getHostContext();
  applyTheme(c?.theme);
  applyMode(c?.displayMode);
});
