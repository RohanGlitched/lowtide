import type { Metadata } from "next";
import Clock from "@/components/Clock";
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
  return (
    <main className={`shell ${s.main}`}>
      <div className={s.head}>
        <h1 className="display">Today, region by region.</h1>
        <p>
          Every region gets a different day. Each dial is its next 24 hours, one fin per half hour (taller costs more, cobalt is
          the cheapest quarter), with the cheapest hour in the middle. Read from the published feeds at{" "}
          {clock(generated, "Europe/London")} London time.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className={s.down}>The price feeds didn&apos;t answer just now. Refresh in a minute.</p>
      ) : (
        <ul className={s.grid}>
          {rows.map((r) => (
            <li key={r.key} className={s.item}>
              <div className={s.dial}>
                {r.chart && (
                  <Clock
                    data={{
                      slots: r.chart.slots,
                      now: r.chart.now,
                      unit: r.unit,
                      timeZone: r.timeZone,
                      berths: [],
                      centre: r.low ? { time: r.low.start, above: "cheapest", below: rate(r.low.avgPrice, { unit: r.unit }) } : null,
                    }}
                    labels={false}
                    label={`${r.name}: cheapest at ${r.low ? clock(r.low.start, r.timeZone) : "—"}`}
                  />
                )}
              </div>
              <h2>{r.name}</h2>
              <p className={s.tariff}>{r.tariff}</p>
              <dl className={s.marks}>
                <div>
                  <dt>Dearest</dt>
                  <dd>{r.high ? `${clock(r.high.start, r.timeZone)}, ${rate(r.high.avgPrice, { unit: r.unit })}` : "—"}</dd>
                </div>
                <div>
                  <dt>Now</dt>
                  <dd>{r.now != null ? rate(r.now, { unit: r.unit }) : "—"}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
      <p className={s.foot}>
        Times are local to each region. Agile prices include VAT; ComEd and German prices are the wholesale energy part of the
        bill, before delivery charges and taxes.
      </p>
    </main>
  );
}
