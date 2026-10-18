"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { SceneData } from "@/lib/live";
import { money } from "@/lib/format";
import TideChart from "./TideChart";
import { Lcd } from "./Lcd";
import s from "./hero.module.css";

function hhmm(t: number, tz: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
}
/** "2 a.m.", "1:30 a.m.", "midnight": how a person says a half hour. */
function spoken(t: number, tz: string) {
  const [h, m] = hhmm(t, tz).split(":").map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const ap = h < 12 ? "a.m." : "p.m.";
  if (h === 0 && m === 0) return "midnight";
  if (h === 12 && m === 0) return "noon";
  return m === 0 ? `${h12} ${ap}` : `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

/** Cheapest and dearest half hour of the next 24 hours, the one under way included (lib/plan.ts cheapAndDear). */
function marks(sc: SceneData) {
  const end = sc.now + 24 * 3600_000;
  const day = sc.slots.filter((x) => x.e > sc.now && x.s < end);
  let low: { start: number; p: number; isNow: boolean } | null = null;
  let high: { start: number; p: number } | null = null;
  for (const x of day) {
    const isNow = x.s <= sc.now && sc.now < x.e;
    if (!low || x.p < low.p) low = { start: x.s, p: x.p, isNow };
    if (!high || x.p > high.p) high = { start: x.s, p: x.p };
  }
  const cur = day.find((x) => x.s <= sc.now && sc.now < x.e) ?? null;
  return { low, high, cur, day };
}

export default function Hero({ places }: { places: { key: string; label: string; scene: SceneData }[] }) {
  const [key, setKey] = useState(places[0].key);
  const place = places.find((p) => p.key === key) ?? places[0];
  const sc = place.scene;
  const tz = sc.timeZone;
  const { low, high, cur, day } = useMemo(() => marks(sc), [sc]);
  const u = sc.unit === "ct" ? " ct" : sc.unit;
  const dish = sc.runs.find((r) => r.id === "dishwasher");
  const all = sc.runs.reduce((a, r) => a + r.cost, 0);
  const allTypical = sc.runs.reduce((a, r) => a + r.costTypical, 0);
  const bars = day.slice(0, 48).map((x) => ({ p: x.p, on: !!dish && x.s >= dish.start && x.s < dish.end }));
  const tonight = !!low && !low.isNow && low.start - sc.now < 14 * 3600_000 && Number(hhmm(low.start, tz).slice(0, 2)) < 9;

  return (
    <section className={s.hero} aria-labelledby="hero-title">
      <div className={s.sky} aria-hidden>
        <span className={s.moon} />
      </div>
      <div className={`shell ${s.grid}`}>
        <div className={s.copy}>
          <p className={s.kicker}>
            <span className={s.pulse} aria-hidden />
            Live {sc.tariff} prices for {place.label}, read at {hhmm(sc.now, tz)}
          </p>
          <h1 id="hero-title" className={`serif ${s.title}`} aria-live="polite">
            Power is cheapest at <em>low tide</em>.{" "}
            {low ? (
              low.isNow ? (
                <>In {place.label}, that&apos;s right now.</>
              ) : (
                <>
                  In {place.label}, that&apos;s {spoken(low.start, tz)}
                  {tonight ? " tonight" : ""}.
                </>
              )
            ) : null}
          </h1>
          <p className={s.lede}>
            Ask Alexa when to run the dishwasher. Lowtide reads every half-hourly electricity price and the grid&apos;s carbon forecast,
            and answers with the cheapest time that still finishes when you need it.
          </p>
          <div className={s.ctas}>
            <Link href="/echo" prefetch={false} className="btn btn-primary">
              Ask Alexa on the Echo
            </Link>
            <Link href="/connect" prefetch={false} className="btn btn-quiet">
              Add to your assistant
            </Link>
          </div>
          <div className={s.switch} role="group" aria-label="Choose a place">
            {places.map((p) => (
              <button key={p.key} type="button" aria-pressed={p.key === key} onClick={() => setKey(p.key)}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {dish && (
          <div className={s.panel} aria-label={`The dishwasher in ${place.label}: start at ${hhmm(dish.start, tz)}`}>
            <Lcd
              size="lg"
              top="Dishwasher, eco 3 h"
              topRight={cur ? `Now ${cur.p.toFixed(1)}${u}` : undefined}
              big={hhmm(dish.start, tz)}
              foot={dish.costTypical > dish.cost ? `${money(dish.cost, sc)}, not ${money(dish.costTypical, sc)}` : money(dish.cost, sc)}
              footRight={`Done by ${hhmm(dish.end, tz)}`}
              bars={bars}
            />
            <div className={s.keys} aria-hidden>
              <span className={s.on}>
                Cheapest<small>by morning</small>
              </span>
              <span>
                Greenest<small>low carbon</small>
              </span>
              <span>
                Done by 7<small>deadline</small>
              </span>
            </div>
            <p className={s.panelNote}>What Lowtide tells Alexa for a {place.label} kitchen, from the tide below.</p>
          </div>
        )}
      </div>

      <div className={`shell ${s.water}`}>
        <TideChart
          key={key}
          slots={sc.slots}
          past={sc.past}
          now={sc.now}
          timeZone={tz}
          unit={sc.unit}
          run={dish ? { start: dish.start, end: dish.end, label: "dishwasher" } : null}
          label={`The next 24 hours of electricity prices in ${place.label} as a tide: high water is dear, low water is cheap. Lowest at ${low ? hhmm(low.start, tz) : "unknown"}.`}
        />
        <dl className={s.facts}>
          <div>
            <dt>Now</dt>
            <dd className="num">{cur ? `${cur.p.toFixed(1)}${u}` : "—"}</dd>
          </div>
          <div>
            <dt>Low tide</dt>
            <dd className={`num ${s.cheap}`}>{low ? (low.isNow ? "now" : hhmm(low.start, tz)) : "—"}</dd>
          </div>
          <div>
            <dt>High tide</dt>
            <dd className={`num ${s.dear}`}>{high ? hhmm(high.start, tz) : "—"}</dd>
          </div>
          <div>
            <dt>Tonight&apos;s {sc.runs.length} loads, planned</dt>
            <dd className="num">
              {sc.runs.length ? money(all, sc) : "—"}
              {sc.runs.length > 0 && <small> not {money(allTypical, sc)}</small>}
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
