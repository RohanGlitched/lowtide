import { getTide } from "@/lib/grid";

/** London's Agile price this half hour, for the header chip to refresh itself on pages cached for longer. */
export async function GET() {
  try {
    const tide = await getTide("SE1 7PB");
    const now = Date.now();
    const cur = tide.slots.find((x) => x.start <= now && now < x.end);
    return Response.json(
      { price: cur ? `${cur.price.toFixed(1)}p` : null, until: cur?.end ?? null },
      { headers: { "cache-control": "public, max-age=0, s-maxage=60" } },
    );
  } catch {
    return Response.json({ price: null }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
