// Frame timing on the home page: idle on the hero, then while scrolling the whole page.
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
(async () => {
  const b = await chromium.launch({ args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(process.argv[2] + "/", { waitUntil: "load" });
  if (process.argv[4]) await p.addStyleTag({ content: process.argv[4] });
  await p.waitForTimeout(Number(process.argv[3] || 4000));
  const measure = (scroll) =>
    p.evaluate(async (scroll) => {
      const times = [];
      let last = performance.now();
      let longTasks = 0;
      const where = [];
      const po = new PerformanceObserver((l) => {
        for (const e of l.getEntries()) {
          longTasks++;
          where.push(`${Math.round(e.duration)}ms@y${Math.round(scrollY)}`);
        }
      });
      po.observe({ entryTypes: ["longtask"] });
      await new Promise((resolve) => {
        const end = last + 4000;
        const step = (t) => {
          times.push(t - last);
          last = t;
          if (scroll) window.scrollBy(0, 18);
          if (t < end) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      });
      po.disconnect();
      times.sort((a, b) => a - b);
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      return { fps: Math.round(1000 / avg), p95ms: Math.round(times[Math.floor(times.length * 0.95)]), worstMs: Math.round(times[times.length - 1]), longTasks, where };
    }, scroll);
  console.log("idle on hero:", await measure(false));
  console.log("scrolling:   ", await measure(true));
  await b.close();
})();
