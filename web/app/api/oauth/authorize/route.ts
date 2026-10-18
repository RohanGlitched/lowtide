import { getTide } from "@/lib/grid";
import { seedHistory } from "@/lib/seed";
import { createHome, loadHome } from "@/lib/store";
import { publicHost, publicOrigin, visitorIp } from "@/lib/origin";
import { checkAuthorize, deniedRedirect, homeIdFrom, issueCode, pickParams } from "@/lib/oauth/authorize";
import { rateLimiter } from "@/lib/oauth/http";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const maxDuration = 30;

/** New households from the consent page: the same cap as /api/homes (20 per address per hour, per instance). */
const allowed = rateLimiter(20, 3600_000);

const see = (url: string) => new Response(null, { status: 303, headers: { location: url, "cache-control": "no-store" } });

/**
 * The consent page's answer. Everything the page showed is checked again here (the form carries the original
 * request, not a session), then the person's choice becomes a single-use code on the client's redirect URI.
 * There is no cookie or session for a forged form to ride on: a household is chosen by creating it here or by
 * pasting its private link, so the Origin check below is belt and braces.
 */
export async function POST(req: Request) {
  const origin = publicOrigin(req);
  const from = req.headers.get("origin");
  if (from && from !== "null") {
    try {
      if (new URL(from).host !== publicHost(req)) return new Response("Cross-site consent isn't allowed.", { status: 403 });
    } catch {
      return new Response("Cross-site consent isn't allowed.", { status: 403 });
    }
  }
  const form = new URLSearchParams(await req.text());
  const params = pickParams(form);
  const back = (extra: Record<string, string>) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][]);
    for (const [k, v] of Object.entries(extra)) q.set(k, v);
    return see(`${origin}/oauth/authorize?${q}`);
  };

  const checked = await checkAuthorize(params, origin);
  if (checked.kind === "fatal") return back({});
  if (checked.kind === "error") return see(checked.redirect);
  const request = checked.request;
  if (form.get("decision") !== "allow") {
    log({ evt: "oauth", step: "consent", ok: false, reason: "denied" });
    return see(deniedRedirect(request, origin));
  }

  let home: string;
  if (form.get("household") === "existing") {
    const link = (form.get("link") ?? "").slice(0, 300);
    const id = homeIdFrom(link);
    if (!id) return back({ lt_pick: "existing", lt_err: "link" });
    if (!(await loadHome(id).catch(() => null))) return back({ lt_pick: "existing", lt_err: "nohome" });
    home = id;
  } else {
    const place = (form.get("place") ?? "").trim().slice(0, 40);
    if (place.length < 2) return back({ lt_err: "place" });
    if (!allowed(visitorIp(req))) return back({ lt_place: place, lt_err: "limit" });
    try {
      const tide = await getTide(place);
      const runs = form.get("demo") === "on" && tide.region.country === "GB" ? await seedHistory(place).catch(() => []) : [];
      home = (await createHome(place, tide.region.country, undefined, runs)).home.id;
    } catch {
      return back({ lt_place: place, lt_err: "tide" });
    }
  }
  const redirect = await issueCode(request, home, origin);
  log({ evt: "oauth", step: "consent", ok: true });
  return see(redirect);
}
