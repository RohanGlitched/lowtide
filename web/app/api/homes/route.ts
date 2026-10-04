import { getTide } from "@/lib/grid";
import { createHome, updateHome } from "@/lib/store";
import { seedHistory } from "@/lib/seed";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Makes a household (and with it a personal MCP link) for a place Lowtide covers. `demo: true` adds two
 * weeks of sample runs priced with the real published rates (Britain only), so the savings tools have
 * something to show on a first visit.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { place?: string; name?: string; demo?: boolean };
  const place = String(body.place ?? "").trim().slice(0, 40);
  if (place.length < 2) return Response.json({ error: "Enter a UK postcode, a northern Illinois town, or Germany." }, { status: 400 });
  try {
    const tide = await getTide(place);
    let state = await createHome(place, tide.region.country, body.name?.slice(0, 40));
    let demo = false;
    if (body.demo && tide.region.country === "GB") {
      const runs = await seedHistory(place).catch(() => []);
      if (runs.length) {
        state = await updateHome(state.home.id, (s) => {
          s.runs = runs;
        });
        demo = true;
      }
    }
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
