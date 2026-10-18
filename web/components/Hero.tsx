"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { SceneData } from "@/lib/live";
import { money } from "@/lib/format";
import { dayPart } from "@/lib/grid/time";
import TideDial from "./TideDial";
import s from "./hero.module.css";

function hhmm(t: number, tz: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
}

/**
 * Cheapest and dearest half hour still to come in the next 24 hours (the one under way included, as "now"): the
 * same basis as the price now, so "cheapest" never reads dearer than "now" (lib/plan.ts cheapAndDear).
 */
function marks(sc: SceneData) {
  const end = sc.now + 24 * 3600_000;
  const day = sc.slots.filter((x) => x.e > sc.now && x.s < end);
  let low: { start: number; p: number; isNow: boolean } | null = null;
  let high: { start: number; p: number; isNow: boolean } | null = null;
  for (const x of day) {
    const isNow = x.s <= sc.now && sc.now < x.e;
    // ties go to the earlier half hour, so the one under way wins a tie with later ones
    if (!low || x.p < low.p) low = { start: x.s, p: x.p, isNow };
    if (!high || x.p > high.p) high = { start: x.s, p: x.p, isNow };
  }
  const cur = day.find((x) => x.s <= sc.now && sc.now < x.e) ?? null;
  const last = day.length ? day[day.length - 1].e : sc.now;
  return { low, high, cur, last };
}

export default function Hero({ places }: { places: { key: string; label: string; scene: SceneData }[] }) {
  const [key, setKey] = useState(places[0].key);
  const place = places.find((p) => p.key === key) ?? places[0];
  const sc = place.scene;
  const tz = sc.timeZone;
  const { low, high, cur, last } = useMemo(() => marks(sc), [sc]);
  // Before tomorrow's prices are out (Agile: about 4 p.m. UK), the next 24 hours stop at the end of today.
  const partial = last - sc.now < 20 * 3600_000;
  const hasPast = partial && sc.past.length > 0;
  const reach = partial ? `to ${hhmm(last, tz)}` : "next 24 hours";
  const u = sc.unit === "ct" ? " ct" : sc.unit;
  const dish = sc.runs.find((r) => r.id === "dishwasher");
  const all = sc.runs.reduce((a, r) => a + r.cost, 0);
  // Savings are quoted against a typical start (the average of every start time in the next 24 hours), not the peak.
  const allTypical = sc.runs.reduce((a, r) => a + r.costTypical, 0);
  // "tomorrow afternoon" reads long in a headline: keep the day, drop the part of it.
  const when = low ? dayPart(low.start, sc.now, tz).replace(/^tomorrow .*/, "tomorrow").replace(/^early this morning$/, "tonight").replace(/^this (afternoon|evening|morning)$/, "today") : "";
  const dishWhen = dish ? dayPart(dish.start, sc.now, tz).replace(/^tomorrow .*/, "tomorrow") : "";
  const rest = low
    ? low.isNow
      ? { above: "Cheapest", big: "Now", below: `${low.p.toFixed(1)}${u} per kWh` }
      : { above: "Cheapest at", big: hhmm(low.start, tz), below: `${low.p.toFixed(1)}${u} per kWh` }
    : { above: "Prices", big: "—", below: "not published yet" };
  const label = `${partial ? `Electricity prices in ${place.label} up to ${hhmm(last, tz)}${hasPast ? ", with earlier today's prices frosted where tomorrow's aren't out yet" : ""}` : `The next 24 hours of electricity prices in ${place.label}`} as a dial of fins, one per half hour; longer is dearer. Cheapest ${low ? (low.isNow ? "now" : `at ${hhmm(low.start, tz)}`) : "unknown"}.`;

  return (
    <section className={s.hero} aria-labelledby="hero-title">
      <div className={`shell ${s.grid}`}>
        <div className={s.copy}>
          <p className={s.live}>
            <span className={s.pulse} aria-hidden />
            Live {sc.tariff} prices for {place.label}, read at {hhmm(sc.now, tz)}
          </p>
          <h1 id="hero-title" className={`display ${s.title}`} aria-live="polite">
            {low ? (
              low.isNow ? (
                <>In {place.label}, power is cheapest right now.</>
              ) : (
                <>
                  In {place.label}, power is cheapest at {hhmm(low.start, tz)} {when}.
                </>
              )
            ) : (
              <>Run it when power is cheapest.</>
            )}
          </h1>
          <p className={s.lede}>
            Ask Alexa when to run the dishwasher. Lowtide reads every half-hourly electricity price and the grid&apos;s carbon
            forecast, and answers with the cheapest time that still finishes when you need it.
          </p>
          <div className={s.ctas}>
            <Link href="/echo" prefetch={false} className="btn btn-primary">
              Ask Alexa on the Echo
            </Link>
            <Link href="/connect" prefetch={false} className="btn btn-quiet">
              Add to your assistant
            </Link>
          </div>
        </div>

        <div className={s.stage}>
          <div className={s.object}>
            <TideDial
              key={key}
              slots={sc.slots}
              past={sc.past}
              now={sc.now}
              timeZone={tz}
              unit={sc.unit}
              run={dish ? { start: dish.start, end: dish.end, label: "dishwasher" } : null}
              label={label}
              rest={rest}
            />
          </div>
          <ul className={s.legend} aria-label="How to read the ring">
            <li>
              <i className={s.kCheap} /> Cheapest quarter
            </li>
            <li>
              <i className={s.kDear} /> Dearest quarter
            </li>
            {hasPast && (
              <li>
                <i className={s.kPast} /> Earlier today, until tomorrow&apos;s prices are out
              </li>
            )}
            {dish && (
              <li>
                <i className={s.kRun} /> The dishwasher&apos;s cheapest run
              </li>
            )}
            <li className={s.drag}>Point at a half hour for its price</li>
          </ul>
        </div>
      </div>

      <div className={`shell ${s.plateWrap}`}>
        <div className={s.plate}>
          <div className={s.plateTop}>
            <div className={s.switch} role="group" aria-label="Choose a place">
              {places.map((p) => (
                <button key={p.key} type="button" aria-pressed={p.key === key} onClick={() => setKey(p.key)}>
                  {p.label}
                </button>
              ))}
            </div>
            <p className={s.caption}>
              {partial ? `${place.label}, now ${reach}` : `${place.label}, the next 24 hours`}. One fin per half hour, cut from the
              published {sc.tariff} prices; longer costs more.
              {partial && sc.currency === "GBP" && " Tomorrow's prices come out at about 4 p.m. UK time."}
            </p>
          </div>
          <dl className={s.spec}>
            <div>
              <dt>Price now</dt>
              <dd>{cur ? `${cur.p.toFixed(1)}${u}` : "—"}</dd>
              <span>per kWh, this half hour</span>
            </div>
            <div>
              <dt>Cheapest half hour</dt>
              <dd className={s.cobalt}>{low ? (low.isNow ? "Now" : hhmm(low.start, tz)) : "—"}</dd>
              <span>{low ? `${low.p.toFixed(1)}${u}/kWh` : ""}</span>
            </div>
            <div>
              <dt>Dearest half hour</dt>
              <dd>{high ? hhmm(high.start, tz) : "—"}</dd>
              <span>{high ? `${high.p.toFixed(1)}${u}/kWh` : ""}</span>
            </div>
            <div>
              <dt>Dishwasher {dishWhen}</dt>
              <dd className={s.cobalt}>{dish ? hhmm(dish.start, tz) : "—"}</dd>
              <span>{dish ? (dish.costTypical > dish.cost ? `${money(dish.cost, sc)}, not ${money(dish.costTypical, sc)} at a typical time` : `${money(dish.cost, sc)}, as cheap as it gets`) : ""}</span>
            </div>
            <div>
              <dt>Tonight&apos;s {sc.runs.length} loads, planned</dt>
              <dd>{sc.runs.length ? money(all, sc) : "—"}</dd>
              <span>{sc.runs.length ? `${money(allTypical, sc)} at a typical time of day` : ""}</span>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}
