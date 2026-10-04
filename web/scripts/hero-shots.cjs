// Frames of the home hero at points through the night. Usage: node scripts/hero-shots.cjs [baseUrl] [outDir]
const path = require("path");
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const BASE = process.argv[2] || "http://localhost:3500";
const OUT = path.resolve(process.argv[3] || "../shots");

(async () => {
  const b = await chromium.launch();
  for (const [name, vp] of [["desk", { width: 1440, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
    const p = await b.newPage({ viewport: vp });
    const errors = [];
    p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    p.on("pageerror", (e) => errors.push(String(e)));
    await p.goto(BASE + "/", { waitUntil: "networkidle" });
    await p.waitForTimeout(2500);
    await p.getByRole("button", { name: /Pause the night/ }).click();
    const strip = p.getByRole("slider", { name: /Time through/ });
    const box = await strip.boundingBox();
    for (const f of name === "desk" ? [0.02, 0.3, 0.42, 0.62, 0.8] : [0.3, 0.8]) {
      await p.mouse.click(box.x + box.width * f, box.y + box.height / 2);
      await p.waitForTimeout(900);
      await p.screenshot({ path: path.join(OUT, `hero-${name}-${Math.round(f * 100)}.png`) });
    }
    console.log(name, "errors:", errors.length ? errors.slice(0, 4).join(" | ") : "none");
    await p.close();
  }
  await b.close();
})();
