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

/** Cheapest and dearest hour (two half hours) in the next 24 hours. */
function marks(sc: SceneData) {
  const end = sc.now + 24 * 3600_000;
  const day = sc.slots.filter((x) => x.e > sc.now && x.s < end);
  let low: { start: number; p: number } | null = null;
  let high: { start: number; p: number } | null = null;
  for (let i = 0; i + 1 < day.length; i++) {
    if (day[i + 1].s !== day[i].e) continue;
    const p = (day[i].p * (day[i].e - day[i].s) + day[i + 1].p * (day[i + 1].e - day[i + 1].s)) / (day[i + 1].e - day[i].s);
    if (!low || p < low.p) low = { start: day[i].s, p };
    if (!high || p > high.p) high = { start: day[i].s, p };
  }
  return { low, high };
}

export default function Hero({ places }: { places: { key: string; label: string; scene: SceneData }[] }) {
  const [key, setKey] = useState(places[0].key);
  const place = places.find((p) => p.key === key) ?? places[0];
  const sc = place.scene;
  const tz = sc.timeZone;
  const { low, high } = useMemo(() => marks(sc), [sc]);
  const u = sc.unit === "ct" ? " ct" : sc.unit;
  const dish = sc.runs.find((r) => r.id === "dishwasher");
  const all = sc.runs.reduce((a, r) => a + r.cost, 0);
  const allSix = sc.runs.reduce((a, r) => a + r.costAtSix, 0);
  // "tomorrow afternoon" reads long in a headline: keep the day, drop the part of it.
  const when = low ? dayPart(low.start, sc.now, tz).replace(/^tomorrow .*/, "tomorrow").replace(/^early this morning$/, "tonight").replace(/^this (afternoon|evening|morning)$/, "today") : "";
  const dishWhen = dish ? dayPart(dish.start, sc.now, tz).replace(/^tomorrow .*/, "tomorrow") : "";
  const baseline = sc.eveningIsNow ? "now" : "at 6 p.m.";

  return (
    <section className={s.hero} aria-labelledby="hero-title">
      <div className={`shell ${s.grid}`}>
        <div className={s.copy}>
          <h1 id="hero-title" className={`display ${s.title}`} aria-live="polite">
            {low ? (
              <>
                In {place.label}, power is cheapest at {hhmm(low.start, tz)} {when}.
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
            <Link href="/echo" className="btn btn-primary">
              Ask Alexa on the Echo
            </Link>
            <Link href="/connect" className="btn btn-quiet">
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
            label={`The next 24 hours of electricity prices in ${place.label} as a ring of 48 fins; taller is dearer. Cheapest at ${low ? hhmm(low.start, tz) : "—"}.`}
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
          The next 24 hours in {place.label}, one fin per half hour, machined from the live {sc.tariff} prices. Taller costs more.
          Cobalt is the cheapest quarter, graphite the dearest; the pin is now. Drag to turn it.
        </p>
        <dl className={s.spec}>
          <div>
            <dt>Cheapest hour</dt>
            <dd>{low ? `${hhmm(low.start, tz)}` : "—"}</dd>
            <span>{low ? `${low.p.toFixed(1)}${u}/kWh` : ""}</span>
          </div>
          <div>
            <dt>Dearest hour</dt>
            <dd>{high ? `${hhmm(high.start, tz)}` : "—"}</dd>
            <span>{high ? `${high.p.toFixed(1)}${u}/kWh` : ""}</span>
          </div>
          <div>
            <dt>Dishwasher {dishWhen}</dt>
            <dd>{dish ? hhmm(dish.start, tz) : "—"}</dd>
            <span>{dish ? (dish.costAtSix > dish.cost ? `${money(dish.cost, sc)} instead of ${money(dish.costAtSix, sc)} ${baseline}` : `${money(dish.cost, sc)}, as cheap as it gets`) : ""}</span>
          </div>
          <div>
            <dt>Everything, next 24 hours</dt>
            <dd>{sc.runs.length ? money(all, sc) : "—"}</dd>
            <span>{sc.runs.length ? `${money(allSix, sc)} if it all ran ${baseline}` : ""}</span>
          </div>
        </dl>
      </div>
    </section>
  );
}
