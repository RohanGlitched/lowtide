// End-to-end: the Echo simulator conversation on a real deployment. Usage: node scripts/e2e.cjs [baseUrl]
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const BASE = process.argv[2] || "https://lowtide-energy.vercel.app";

async function say(page, text) {
  const before = await page.locator("li[data-who=alexa]").count();
  await page.getByLabel("Type what you would say").fill(text);
  await page.getByRole("button", { name: "Say it" }).click();
  await page.waitForFunction((n) => document.querySelectorAll("li[data-who=alexa]").length > n, before, { timeout: 60000 });
  const reply = await page.locator("li[data-who=alexa]").last().textContent();
  const tools = await page.locator("li[data-who=tool]").allTextContents();
  await page.waitForFunction(() => !document.querySelector("button[disabled][title*='Talk']") || true);
  await page.getByRole("button", { name: "Say it" }).waitFor();
  return { reply, lastTool: tools[tools.length - 1] };
}

(async () => {
  const b = await chromium.launch();
  for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const ctx = await b.newContext({ viewport: vp });
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(String(e)));
    const t0 = Date.now();
    await page.goto(BASE + "/echo", { waitUntil: "domcontentloaded" });
    await page.frameLocator("iframe").locator(".headline").waitFor({ timeout: 60000 });
    console.log(`\n[${vp.width}px] ready in ${Date.now() - t0} ms; engine: ${await page.locator("p", { hasText: "Understanding:" }).textContent()}`);
    const steps = [
      "When should I run the dishwasher? It needs to be done by 7am",
      "Yes please",
      "What have I got planned?",
      "How much have I saved?",
      "Is now a good time to use the tumble dryer?",
    ];
    for (const s of steps) {
      // Wait until the previous turn has finished speaking (inputs re-enable).
      await page.waitForFunction(() => !document.querySelector("#say")?.closest("form")?.querySelector("button")?.disabled || document.querySelector("#say").value === "", null, { timeout: 30000 });
      const r = await say(page, s);
      const headline = await page.frameLocator("iframe").locator(".headline").textContent();
      console.log(`you: ${s}\n  tool: ${r.lastTool}\n  screen: ${headline}\n  alexa: ${r.reply}`);
      await page.waitForTimeout(600);
    }
    const sw = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    console.log(`overflow ${sw}px; console errors: ${errors.length ? errors.join(" | ") : "none"}`);
    await ctx.close();
  }
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
