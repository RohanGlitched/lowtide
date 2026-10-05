import { getTide } from "@/lib/grid";
import { createHome } from "@/lib/store";
import { seedHistory } from "@/lib/seed";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Makes a household (and with it a personal MCP link) for a place Lowtide covers. `demo: true` adds two
 * weeks of sample runs priced with the real published rates (Britain only), so the savings tools have
 * something to show on a first visit.
 */
const recent = new Map<string, number[]>();
const HOUR = 3600_000;

/** At most 20 new households per visitor per hour (per server instance); quiet addresses are forgotten, not everyone. */
function allowed(ip: string): boolean {
  const now = Date.now();
  const list = (recent.get(ip) ?? []).filter((t) => now - t < HOUR);
  if (list.length >= 20) return false;
  list.push(now);
  recent.set(ip, list);
  if (recent.size > 5000) for (const [k, v] of recent) if (!v.some((t) => now - t < HOUR)) recent.delete(k);
  return true;
}

export async function POST(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  if (!allowed(ip)) return Response.json({ error: "That's a lot of households. Try again in an hour." }, { status: 429 });
  const body = (await req.json().catch(() => ({}))) as { place?: unknown; name?: unknown; demo?: unknown };
  const place = typeof body.place === "string" ? body.place.trim().slice(0, 40) : "";
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 40) : undefined;
  if (place.length < 2) return Response.json({ error: "Enter a UK postcode, a northern Illinois town, or Germany." }, { status: 400 });
  try {
    const tide = await getTide(place);
    // A demo household is written once, with its history, so its first read is never stale.
    const runs = body.demo && tide.region.country === "GB" ? await seedHistory(place).catch(() => []) : [];
    const state = await createHome(place, tide.region.country, name, runs);
    const demo = runs.length > 0;
    const origin = new URL(req.url).origin;
    return Response.json({
      id: state.home.id,
      region: tide.region.name,
      tariff: tide.region.tariff,
      mcpUrl: `${origin}/api/mcp/h/${state.home.id}`,
      demo,
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Couldn't set that up." }, { status: 400 });
  }
}
