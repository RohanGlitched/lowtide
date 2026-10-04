// Screenshots for review. Usage: node scripts/shots.cjs [baseUrl] [outDir] [pages...]
const path = require("path");
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const BASE = process.argv[2] || "http://localhost:3500";
const OUT = path.resolve(process.argv[3] || "../shots");
const only = process.argv.slice(4);

(async () => {
  const b = await chromium.launch();
  for (const [name, vp] of [["desk", { width: 1440, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
    for (const scheme of ["light", "dark"]) {
      if (scheme === "dark" && name === "phone") continue;
      const ctx = await b.newContext({ viewport: vp, colorScheme: scheme, deviceScaleFactor: 1 });
      const p = await ctx.newPage();
      const errors = [];
      p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      p.on("pageerror", (e) => errors.push(String(e)));
      if (!only.length || only.includes("echo")) {
        await p.goto(BASE + "/echo", { waitUntil: "domcontentloaded" });
        await p.frameLocator("iframe").locator(".headline").waitFor({ timeout: 60000 });
        await p.waitForTimeout(2500);
        await p.screenshot({ path: path.join(OUT, `echo-${name}-${scheme}.png`), fullPage: true });
        if (scheme === "light") {
          await p.getByRole("button", { name: /When should I run the dishwasher/ }).click();
          await p.waitForFunction(() => document.querySelectorAll("li[data-who=alexa]").length > 0, null, { timeout: 60000 });
          await p.waitForTimeout(2500);
          await p.screenshot({ path: path.join(OUT, `echo-${name}-plan.png`), fullPage: true });
          console.log(name, "alexa:", await p.locator("li[data-who=alexa]").last().textContent());
        }
      }
      for (const page of ["", "connect", "tables"]) {
        if (only.length && !only.includes(page || "home")) continue;
        const r = await p.goto(BASE + "/" + page, { waitUntil: "networkidle" }).catch(() => null);
        if (!r || r.status() >= 400) continue;
        await p.waitForTimeout(2000);
        await p.screenshot({ path: path.join(OUT, `${page || "home"}-${name}-${scheme}.png`), fullPage: true });
      }
      const sw = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      console.log(name, scheme, "overflow:", sw, errors.length ? "errors: " + errors.slice(0, 5).join(" | ") : "no errors");
      await ctx.close();
    }
  }
  await b.close();
})();
