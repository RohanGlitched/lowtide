// README screenshots and the object clip, from a live deployment.
// Usage: node scripts/readme-shots.cjs [baseUrl]   (writes ../docs/screens/*.png and ../docs/raw/object.webm)
const fs = require("fs");
const path = require("path");
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");

const BASE = process.argv[2] || "https://lowtide-energy.vercel.app";
const OUT = path.join(__dirname, "..", "..", "docs", "screens");
const RAW = path.join(__dirname, "..", "..", "docs", "raw");
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(RAW, { recursive: true });
const GPU = ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"];

async function at(page, name, selector, offset = 80) {
  if (selector) {
    await page.evaluate(([s, o]) => {
      const el = document.querySelector(s);
      if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - o });
    }, [selector, offset]);
    await page.waitForTimeout(2500);
  }
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(name);
}

(async () => {
  const b = await chromium.launch({ args: GPU });

  // Desktop pages.
  const d = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await d.goto(BASE + "/", { waitUntil: "load" });
  await d.waitForTimeout(5000);
  await at(d, "home-hero");
  await d.getByRole("tab", { name: "Glasgow" }).click();
  await d.waitForTimeout(3500);
  await at(d, "home-glasgow");
  await d.getByRole("tab", { name: "London" }).click();
  await at(d, "home-ask", "#ask-title", 300);
  await at(d, "home-pick", "#pick-title", 60);
  await d.getByRole("radio", { name: /Car/ }).click();
  await d.waitForTimeout(3000);
  await at(d, "home-pick-car");
  await at(d, "home-how", "#how-title", 60);

  await d.goto(BASE + "/tables", { waitUntil: "load" });
  await d.waitForTimeout(3500);
  await at(d, "tables");
  await d.goto(BASE + "/connect", { waitUntil: "load" });
  await d.waitForTimeout(1500);
  await at(d, "connect");

  // The Echo, mid conversation (Claude Haiku on Bedrock).
  await d.goto(BASE + "/echo", { waitUntil: "load" });
  await d.frameLocator("iframe").locator(".headline").waitFor({ timeout: 90000 });
  await d.waitForTimeout(2500);
  await at(d, "echo-idle");
  await d.getByLabel("Type what you would say").fill("When should I run the dishwasher? It needs to be done by 7.");
  await d.getByRole("button", { name: "Say it" }).click();
  await d.waitForFunction(() => document.querySelectorAll("li[data-who=alexa]").length > 0, null, { timeout: 90000 });
  await d.waitForTimeout(1200);
  await at(d, "echo-plan");
  await d.waitForTimeout(9000);
  await d.getByLabel("Type what you would say").fill("Yes please");
  await d.getByRole("button", { name: "Say it" }).click();
  await d.waitForFunction(() => document.querySelectorAll("li[data-who=alexa]").length > 1, null, { timeout: 90000 });
  await d.waitForTimeout(1200);
  await at(d, "echo-scheduled");
  await d.close();

  // Phone.
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p.goto(BASE + "/", { waitUntil: "load" });
  await p.waitForTimeout(5000);
  await at(p, "phone-home");
  await at(p, "phone-object", "[role=tablist]", 520);
  await p.goto(BASE + "/echo", { waitUntil: "load" });
  await p.frameLocator("iframe").locator(".headline").waitFor({ timeout: 90000 });
  await p.waitForTimeout(2000);
  await at(p, "phone-echo", "[aria-label='Simulated Echo Show']", 20);
  await p.close();

  // A clip of the object: London, then re-cut for Glasgow, Chicago and Berlin.
  const ctx = await b.newContext({ viewport: { width: 1200, height: 760 }, recordVideo: { dir: RAW, size: { width: 1200, height: 760 } } });
  const v = await ctx.newPage();
  await v.goto(BASE + "/", { waitUntil: "load" });
  await v.addStyleTag({ content: "header, [class*=copy], [class*=below] { visibility: hidden !important; } [class*=object] { margin: 0 !important; }" });
  await v.evaluate(() => {
    const o = document.querySelector("[class*=hero] [class*=object]");
    if (o) Object.assign(o.style, { position: "fixed", inset: "0", height: "100vh", width: "100vw", zIndex: 5, background: "#e9ebee" });
  });
  await v.waitForTimeout(5000);
  for (const city of ["Glasgow", "Chicago", "Berlin", "London"]) {
    await v.evaluate((c) => [...document.querySelectorAll("[role=tab]")].find((t) => t.textContent === c)?.click(), city);
    await v.waitForTimeout(3200);
  }
  const vid = v.video();
  await ctx.close();
  fs.renameSync(await vid.path(), path.join(RAW, "object.webm"));
  console.log("object.webm");
  await b.close();
})();
