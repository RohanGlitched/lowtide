import { App } from "@modelcontextprotocol/ext-apps";
import { drawTide, type ChartData } from "./chart";

interface ViewData extends Omit<ChartData, "unit" | "timeZone" | "slots"> {
  kind: string;
  headline: string;
  sub: string;
  region: { name: string; tariff: string; unit: "p" | "¢" | "ct"; currency: string; timeZone: string; priceNote: string; carbonSource: string | null };
  slots: ChartData["slots"];
  facts: { label: string; value: string }[];
  mix: { fuel: string; perc: number }[] | null;
}

const root = document.getElementById("root")!;
let last: ViewData | null = null;
let drawn = false;

function text(tag: string, cls: string, s: string) {
  const n = document.createElement(tag);
  n.className = cls;
  n.textContent = s;
  return n;
}

const FUEL_NAMES: Record<string, string> = {
  wind: "wind",
  solar: "solar",
  nuclear: "nuclear",
  gas: "gas",
  imports: "imports",
  biomass: "biomass",
  hydro: "hydro",
  coal: "coal",
  other: "other",
};

function render(d: ViewData) {
  last = d;
  root.replaceChildren();
  root.dataset.kind = d.kind;

  const head = document.createElement("header");
  head.append(text("h1", "headline", d.headline));
  if (d.sub) head.append(text("p", "sub", d.sub));
  root.append(head);

  const chart = document.createElement("figure");
  chart.className = "chart";
  const plot = document.createElement("div");
  plot.className = "plot";
  chart.append(plot);
  root.append(chart);
  const legend = document.createElement("figcaption");
  legend.append(text("span", "key key-water", `${d.region.tariff} price`));
  if (d.slots.some((s) => s.c != null)) legend.append(text("span", "key key-carbon", "grid carbon"));
  legend.append(text("span", "key key-now", "now"));
  chart.append(legend);

  if (d.facts.length) {
    const dl = document.createElement("dl");
    dl.className = "facts";
    for (const f of d.facts) {
      const div = document.createElement("div");
      div.append(text("dt", "", f.label), text("dd", "", f.value));
      dl.append(div);
    }
    root.append(dl);
  }

  const foot = document.createElement("footer");
  if (d.mix?.length) {
    const mix = document.createElement("div");
    mix.className = "mix";
    mix.setAttribute("aria-label", "Generation mix now");
    const bar = document.createElement("div");
    bar.className = "mixbar";
    for (const m of d.mix) {
      const seg = document.createElement("span");
      seg.className = `fuel fuel-${m.fuel}`;
      seg.style.flexGrow = String(m.perc);
      seg.title = `${FUEL_NAMES[m.fuel] ?? m.fuel} ${m.perc}%`;
      bar.append(seg);
    }
    mix.append(bar);
    mix.append(text("p", "mixtext", "Grid now: " + d.mix.slice(0, 4).map((m) => `${FUEL_NAMES[m.fuel] ?? m.fuel} ${Math.round(m.perc)}%`).join(", ")));
    foot.append(mix);
  }
  foot.append(text("p", "source", `${d.region.name}. ${d.region.priceNote}${d.region.carbonSource ? ` Carbon: ${d.region.carbonSource}.` : ""}`));
  root.append(foot);

  // On a device screen (fullscreen) the chart takes whatever height is left; inline it sizes itself.
  const fit = root.classList.contains("fit");
  drawTide(
    plot,
    { slots: d.slots, now: d.now, marks: d.marks, berths: d.berths, unit: d.region.unit, timeZone: d.region.timeZone },
    { animate: !drawn, height: fit ? plot.clientHeight : undefined },
  );
  drawn = true;
}

function applyMode(mode?: string) {
  const fit = mode === "fullscreen";
  if (fit !== root.classList.contains("fit")) {
    root.classList.toggle("fit", fit);
    if (last) render(last);
  }
}

function applyTheme(theme?: string) {
  if (theme === "dark" || theme === "light") document.documentElement.dataset.theme = theme;
}

const app = new App({ name: "Lowtide tide chart", version: "1.0.0" });
app.ontoolresult = (params) => {
  const sc = (params as { structuredContent?: unknown }).structuredContent as ViewData | undefined;
  if (sc && Array.isArray(sc.slots)) render(sc);
  else {
    const t = (params as { content?: { type: string; text?: string }[] }).content?.find((c) => c.type === "text")?.text;
    root.replaceChildren(text("p", "error", t ?? "Lowtide couldn't read the prices just now."));
  }
};
app.ontoolinput = () => {
  if (!last) root.replaceChildren(text("p", "loading", "Reading the tide tables…"));
};
app.ontoolcancelled = (p) => {
  root.replaceChildren(text("p", "error", (p as { reason?: string }).reason ?? "Cancelled."));
};
app.onhostcontextchanged = (ctx) => {
  const c = ctx as { theme?: string; displayMode?: string };
  applyTheme(c.theme);
  if (c.displayMode) applyMode(c.displayMode);
};

// Redraw on width changes only (height follows the content, so watching it would loop).
let resizeTimer = 0;
let lastWidth = 0;
new ResizeObserver(([entry]) => {
  const w = Math.round(entry.contentRect.width) + (root.classList.contains("fit") ? Math.round(entry.contentRect.height) * 100000 : 0);
  if (w === lastWidth) return;
  lastWidth = w;
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => last && render(last), 120);
}).observe(document.documentElement);

app.connect().then(() => {
  const c = app.getHostContext();
  applyTheme(c?.theme);
  applyMode(c?.displayMode);
});
