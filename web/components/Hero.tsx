"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { SceneData } from "@/lib/live";
import { money } from "@/lib/format";
import { dayPart } from "@/lib/grid/time";
import s from "./hero.module.css";

const DayObject = dynamic(() => import("./object/DayObject"), {
  ssr: false,
  loading: () => <div className={s.objectWait} aria-hidden />,
});

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
  const last = day.length ? day[day.length - 1].e : sc.now;
  return { low, high, last };
}

export default function Hero({ places }: { places: { key: string; label: string; scene: SceneData }[] }) {
  const [key, setKey] = useState(places[0].key);
  const place = places.find((p) => p.key === key) ?? places[0];
  const sc = place.scene;
  const tz = sc.timeZone;
  const { low, high, last } = useMemo(() => marks(sc), [sc]);
  // Before tomorrow's prices are out (Agile: about 4 p.m. UK), the ring only reaches the end of today.
  const partial = last - sc.now < 20 * 3600_000;
  const reach = partial ? `to ${hhmm(last, tz)}` : "next 24 hours";
  const u = sc.unit === "ct" ? " ct" : sc.unit;
  const dish = sc.runs.find((r) => r.id === "dishwasher");
  const all = sc.runs.reduce((a, r) => a + r.cost, 0);
  // Savings are quoted against a typical start (the average of every start time in the next 24 hours), not the peak.
  const allTypical = sc.runs.reduce((a, r) => a + r.costTypical, 0);
  // "tomorrow afternoon" reads long in a headline: keep the day, drop the part of it.
  const when = low ? dayPart(low.start, sc.now, tz).replace(/^tomorrow .*/, "tomorrow").replace(/^early this morning$/, "tonight").replace(/^this (afternoon|evening|morning)$/, "today") : "";
  const dishWhen = dish ? dayPart(dish.start, sc.now, tz).replace(/^tomorrow .*/, "tomorrow") : "";

  return (
    <section className={s.hero} aria-labelledby="hero-title">
      <div className={`shell ${s.grid}`}>
        <div className={s.copy}>
          <h1 id="hero-title" className={`display ${s.title}`} aria-live="polite">
            {low ? (
              <>
                {low.isNow ? <>In {place.label}, power is cheapest right now.</> : <>In {place.label}, power is cheapest at {hhmm(low.start, tz)} {when}.</>}
              </>
            ) : (
              <>Run it when power is cheapest.</>
            )}
          </h1>
          <p className={s.lede}>
            Lowtide reads every half-hourly electricity price and the grid&apos;s carbon forecast, and tells Alexa when to run the
            dishwasher, the washing, the hot water and the car.
          </p>
          <div className={s.ctas}>
            <Link href="/echo" prefetch={false} className="btn btn-primary">
              Ask Alexa on the Echo
            </Link>
            <Link href="/connect" prefetch={false} className="btn btn-quiet">
              Add to Claude or ChatGPT
            </Link>
          </div>
        </div>
        <div className={s.object}>
          <DayObject
            slots={sc.slots}
            now={sc.now}
            timeZone={tz}
            unit={sc.unit}
            label={`${partial ? `Electricity prices in ${place.label} up to ${hhmm(last, tz)}` : `The next 24 hours of electricity prices in ${place.label}`} as a ring of fins, one per half hour; taller is dearer. Cheapest ${low ? (low.isNow ? "now" : `at ${hhmm(low.start, tz)}`) : "—"}.`}
          />
        </div>
      </div>

      <div className={`shell ${s.below}`}>
        <div className={s.switch} role="group" aria-label="Choose a place">
          {places.map((p) => (
            <button key={p.key} type="button" aria-pressed={p.key === key} onClick={() => setKey(p.key)}>
              {p.label}
            </button>
          ))}
        </div>
        <p className={s.caption}>
          {partial ? `${place.label} from now ${reach}` : `The next 24 hours in ${place.label}`}, one fin per half hour, machined from
          the live {sc.tariff} prices. Taller costs more. Cobalt is the cheapest quarter, graphite the dearest; the pin is now. Drag
          to turn it.
          {partial &&
            (sc.currency === "GBP"
              ? ` Tomorrow's prices come out at about 4 p.m. UK time; until then the ring holds the rest of today, so it isn't full yet.`
              : ` Tomorrow's prices aren't published yet, so the ring holds the rest of today.`)}{" "}
          Savings below compare with a typical start: the average of every published start time, not the evening peak.
        </p>
        <dl className={s.spec}>
          <div>
            <dt>Cheapest half hour</dt>
            <dd>{low ? (low.isNow ? "Now" : hhmm(low.start, tz)) : "—"}</dd>
            <span>{low ? `${low.p.toFixed(1)}${u}/kWh` : ""}</span>
          </div>
          <div>
            <dt>Dearest half hour</dt>
            <dd>{high ? `${hhmm(high.start, tz)}` : "—"}</dd>
            <span>{high ? `${high.p.toFixed(1)}${u}/kWh` : ""}</span>
          </div>
          <div>
            <dt>Dishwasher {dishWhen}</dt>
            <dd>{dish ? hhmm(dish.start, tz) : "—"}</dd>
            <span>{dish ? (dish.costTypical > dish.cost ? `${money(dish.cost, sc)} instead of ${money(dish.costTypical, sc)} at a typical time` : `${money(dish.cost, sc)}, as cheap as it gets`) : ""}</span>
          </div>
          <div>
            <dt>Everything, {reach}</dt>
            <dd>{sc.runs.length ? money(all, sc) : "—"}</dd>
            <span>{sc.runs.length ? `${money(allTypical, sc)} at a typical time of day` : ""}</span>
          </div>
        </dl>
      </div>
    </section>
  );
}
