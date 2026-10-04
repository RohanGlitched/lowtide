import type { Metadata } from "next";
import TideChart from "@/components/TideChart";
import { tableData } from "@/lib/live";
import { clock } from "@/lib/grid/time";
import { rate } from "@/lib/format";
import s from "./tables.module.css";

export const revalidate = 300;
export const metadata: Metadata = {
  title: "Tide tables",
  description: "Low and high water for electricity today: every British Agile region, northern Illinois and Germany.",
};

export default async function Tables() {
  const rows = await tableData();
  const generated = Date.now();
  return (
    <main className={`shell ${s.main}`}>
      <h1>Tide tables</h1>
      <p className={s.lede}>
        Low water (the cheapest hour) and high water (the dearest) over the next 24 hours, for every region Lowtide covers.
        Read from the published feeds at {clock(generated, "Europe/London")} London time.
      </p>
      {rows.length === 0 ? (
        <p className={s.down}>The price feeds didn&apos;t answer just now. Refresh in a minute.</p>
      ) : (
        <ol className={s.list}>
          {rows.map((r) => (
            <li key={r.key} className={s.row}>
              <div className={s.name}>
                <h2>{r.name}</h2>
                <p>{r.tariff}</p>
              </div>
              <dl className={s.marks}>
                <div>
                  <dt>Low water</dt>
                  <dd className={s.lw}>{r.low ? `${clock(r.low.start, r.timeZone)} · ${rate(r.low.avgPrice, { unit: r.unit })}` : "—"}</dd>
                </div>
                <div>
                  <dt>High water</dt>
                  <dd>{r.high ? `${clock(r.high.start, r.timeZone)} · ${rate(r.high.avgPrice, { unit: r.unit })}` : "—"}</dd>
                </div>
                <div>
                  <dt>Now</dt>
                  <dd>{r.now != null ? rate(r.now, { unit: r.unit }) : "—"}</dd>
                </div>
              </dl>
              <div className={s.mini}>
                {r.chart && <TideChart data={r.chart} height={150} compact label={`Price curve for ${r.name}`} />}
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className={s.foot}>
        Times are local to each region. Agile prices include VAT; ComEd and German prices are the wholesale energy part of
        the bill, before delivery charges and taxes.
      </p>
    </main>
  );
}
