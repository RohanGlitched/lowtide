// Quick full-page and viewport screenshots of given paths. Usage: node scripts/look.cjs base out path...
const path = require("path");
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const [base, out, ...paths] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ headless: true, args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"] });
  for (const [name, vp] of [["desk", { width: 1440, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
    const p = await b.newPage({ viewport: vp });
    const errors = [];
    p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    p.on("pageerror", (e) => errors.push(String(e)));
    for (const route of paths) {
      await p.goto(base + route, { waitUntil: "load" });
      await p.waitForTimeout(3500);
      const slug = route === "/" ? "home" : route.replace(/\//g, "");
      await p.screenshot({ path: path.join(out, `${slug}-${name}.png`) });
      await p.screenshot({ path: path.join(out, `${slug}-${name}-full.png`), fullPage: true });
      const sw = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      console.log(route, name, "overflow", sw);
    }
    console.log(name, "errors:", errors.length ? errors.slice(0, 5).join(" | ") : "none");
    await p.close();
  }
  await b.close();
})();
