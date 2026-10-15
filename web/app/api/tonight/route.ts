import { HOME_ID } from "@/lib/store";
import { rollTonight, tonightForHome, tonightForPlace } from "@/lib/tonight";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const maxDuration = 20;

/**
 * GET /api/tonight?home=<id> (or ?place=<postcode>): tonight's plan as a proactive card for the Echo simulator
 * and the website. For a household it is computed once per night and stored; each call also takes one short,
 * bounded step of the nightly roll for other households, so their plans are ready before they ask.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const home = q.get("home") ?? "";
  const place = (q.get("place") ?? "").trim().slice(0, 40);
  const t0 = Date.now();
  try {
    let body: { ready: boolean; plan: unknown; card: { headline: string; sentence: string; unusual: boolean; night: string } | null; fresh?: boolean };
    if (home) {
      if (!HOME_ID.test(home)) return Response.json({ error: "This isn't a Lowtide household link." }, { status: 404 });
      const r = await tonightForHome(home);
      body = { ready: r.ready, plan: r.plan, fresh: r.fresh, card: r.plan ? { headline: r.plan.headline, sentence: r.plan.sentence, unusual: r.plan.unusual, night: r.plan.night } : null };
      log({ evt: "tonight", scope: "home", ms: Date.now() - t0, ok: true, computed: r.fresh ? 1 : 0, night: r.plan?.night });
      // one bounded step for everyone else (does nothing until Agile has published, or once the night is done)
      await rollTonight({ limit: 10, budgetMs: 1200 });
    } else if (place.length >= 2) {
      const r = await tonightForPlace(place);
      body = { ready: r.ready, plan: r.plan, card: r.plan ? { headline: r.plan.headline, sentence: r.plan.sentence, unusual: r.plan.unusual, night: r.plan.night } : null };
    } else {
      return Response.json({ error: "Pass ?home=<household id> or ?place=<postcode or city>." }, { status: 400 });
    }
    return Response.json(body, { headers: { "cache-control": home ? "no-store" : "public, max-age=0, s-maxage=300" } });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log({ evt: "tonight", scope: "home", ms: Date.now() - t0, ok: false, error });
    return Response.json({ error, ready: false, plan: null, card: null }, { status: /doesn't match a household/.test(error) ? 404 : 502 });
  }
}
