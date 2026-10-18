import type { Metadata } from "next";
import Link from "next/link";
import TideChart from "@/components/TideChart";
import { tableData } from "@/lib/live";
import { clock } from "@/lib/grid/time";
import { rate } from "@/lib/format";
import s from "./tables.module.css";

export const revalidate = 300;
export const metadata: Metadata = {
  title: "Today's tides",
  description: "The next 24 hours of electricity prices for every British Agile region, northern Illinois and Germany.",
};

export default async function Tables() {
  const rows = await tableData();
  const generated = Date.now();
  // Before Octopus publishes tomorrow (about 16:00 UK), Agile only runs to 23:00 tonight: say why part of each dial is frosted.
  const gbEnds = rows.filter((r) => r.key.startsWith("GB-") && r.chart?.slots.length).map((r) => r.chart!.slots[r.chart!.slots.length - 1].e);
  const partial = gbEnds.length > 0 && Math.max(...gbEnds) - generated < 20 * 3600_000;
  const partialEnd = partial ? clock(Math.max(...gbEnds), "Europe/London") : "";
  // Britain's 14 regions share a unit and a clock, so they can be ranked against each other.
  const gb = rows.filter((r) => r.key.startsWith("GB-") && r.now != null).sort((a, b) => a.now! - b.now!);
  const gbLo = gb.length ? gb[0].now! : 0;
  const gbHi = gb.length ? gb[gb.length - 1].now! : 1;

  return (
    <main id="main" tabIndex={-1}>
      <section className={`shell ${s.main}`} aria-labelledby="tides-title">
        <div className="sectionHead">
          <h1 id="tides-title" className={`serif ${s.title}`}>
            Today, region by region.
          </h1>
          <p>
            Every region gets a different night. Each tide is its next 24 hours of half-hourly prices: high water is dear, low
            water is cheap. Point anywhere on a tide for its price. Read from the published feeds at {clock(generated, "Europe/London")}{" "}
            London time.
          </p>
        </div>

        {gb.length > 1 && (
          <div className={s.rank}>
            <div className={s.rankHead}>
              <h2>Right now, cheapest first</h2>
              <p>
                This half hour&apos;s Agile price in each British region. The same tariff costs {rate(gbHi - gbLo, { unit: "p" })} more in{" "}
                {gb[gb.length - 1].name} than in {gb[0].name}.
              </p>
            </div>
            <ol className={s.bars}>
              {gb.map((r, i) => (
                <li key={r.key}>
                  <span className={s.barName}>{r.name}</span>
                  <span className={s.barTrack}>
                    <span
                      className={`${s.bar} ${i === 0 ? s.barLow : i === gb.length - 1 ? s.barHigh : ""}`}
                      style={{ width: `${30 + ((r.now! - gbLo) / Math.max(0.01, gbHi - gbLo)) * 70}%` }}
                    />
                  </span>
                  <span className={s.barValue}>{rate(r.now!, { unit: "p" })}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {partial && (
          <p className={s.partial}>
            Tomorrow&apos;s Agile prices come out at about 4 p.m. UK time. Until then the British tides are published to {partialEnd}, and
            the rest of each is earlier today&apos;s price for that half hour, dotted.
          </p>
        )}
      </section>

      <section className="shell" aria-label="Every region">
        {rows.length === 0 ? (
          <p className={s.down}>The price feeds didn&apos;t answer just now. Refresh in a minute.</p>
        ) : (
          <ul className={s.grid}>
            {rows.map((r) => {
              const u = r.unit === "ct" ? " ct" : r.unit;
              return (
                <li key={r.key} className={s.item}>
                  <div className={s.meta}>
                    <h2>{r.name}</h2>
                    <p className={s.tariff}>{r.tariff}</p>
                  </div>
                  {r.chart && (
                    <TideChart
                      compact
                      height={120}
                      slots={r.chart.slots}
                      past={r.chart.past}
                      now={r.chart.now}
                      timeZone={r.timeZone}
                      unit={r.unit}
                      label={`${r.name}: cheapest ${r.low ? (r.low.isNow ? "now" : `at ${clock(r.low.start, r.timeZone)}`) : "unknown"}`}
                    />
                  )}
                  <dl className={s.marks}>
                    <div>
                      <dt>Low tide</dt>
                      <dd className={s.low}>{r.low ? (r.low.isNow ? "now" : clock(r.low.start, r.timeZone)) : "—"}</dd>
                      <span>{r.low ? `${r.low.avgPrice.toFixed(1)}${u}` : ""}</span>
                    </div>
                    <div>
                      <dt>Now</dt>
                      <dd>{r.now != null ? `${r.now.toFixed(1)}${u}` : "—"}</dd>
                      <span>per kWh</span>
                    </div>
                    <div>
                      <dt>High tide</dt>
                      <dd className={s.high}>{r.high ? clock(r.high.start, r.timeZone) : "—"}</dd>
                      <span>{r.high ? `${r.high.avgPrice.toFixed(1)}${u}` : ""}</span>
                    </div>
                  </dl>
                </li>
              );
            })}
          </ul>
        )}
        <div className={s.foot}>
          <p>
            Times are local to each region. Agile prices include VAT; ComEd and German prices are the wholesale energy part of the
            bill, before delivery charges and taxes.
          </p>
          <Link href="/echo" prefetch={false} className="btn btn-primary">
            Ask Alexa for your postcode
          </Link>
        </div>
      </section>
    </main>
  );
}
