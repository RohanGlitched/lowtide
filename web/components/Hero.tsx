"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { SceneData } from "@/lib/live";
import { money } from "@/lib/format";
import TideChart from "./TideChart";
import { usePlace } from "./place";
import { Lcd } from "./Lcd";
import s from "./hero.module.css";

function hhmm(t: number, tz: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
}
/** "2 a.m.", "1:30 a.m.", "midnight": how a person says a half hour. */
function spoken(t: number, tz: string) {
  const [h, m] = hhmm(t, tz).split(":").map(Number);
  if (h === 0 && m === 0) return "midnight";
  if (h === 12 && m === 0) return "noon";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const ap = h < 12 ? "a.m." : "p.m.";
  return m === 0 ? `${h12} ${ap}` : `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

type Slot = SceneData["slots"][number];
type Mode = "cheapest" | "greenest" | "now";
const DISH = { kwh: 0.9, minutes: 180 };

/** What a run starting at `start` costs (minor units) and emits (g), or null if prices don't cover it. */
function costAt(slots: Slot[], start: number) {
  const end = start + DISH.minutes * 60_000;
  const perMs = DISH.kwh / (end - start);
  let cost = 0;
  let carbon: number | null = 0;
  let covered = 0;
  for (const x of slots) {
    const a = Math.max(start, x.s);
    const b = Math.min(end, x.e);
    if (b <= a) continue;
    cost += perMs * (b - a) * x.p;
    carbon = carbon === null || x.c === null ? null : carbon + perMs * (b - a) * x.c;
    covered += b - a;
  }
  return covered < end - start - 1000 ? null : { start, end, cost, carbon };
}

/** The greenest dishwasher start that still finishes by `deadline` (lowest grid carbon), from the same prices. */
function greenest(slots: Slot[], now: number, deadline: number) {
  let best: ReturnType<typeof costAt> = null;
  const first = Math.ceil(now / 1800_000) * 1800_000;
  for (let t = first; t + DISH.minutes * 60_000 <= deadline; t += 1800_000) {
    const r = costAt(slots, t);
    if (r && r.carbon !== null && (!best || r.carbon < best.carbon!)) best = r;
  }
  return best;
}

/** Cheapest and dearest half hour of the next 24 hours, the one under way included (lib/plan.ts cheapAndDear). */
function marks(sc: SceneData) {
  const end = sc.now + 24 * 3600_000;
  const day = sc.slots.filter((x) => x.e > sc.now && x.s < end);
  let low: { start: number; p: number } | null = null;
  let high: { start: number; p: number } | null = null;
  for (const x of day) {
    if (!low || x.p < low.p) low = { start: x.s, p: x.p };
    if (!high || x.p > high.p) high = { start: x.s, p: x.p };
  }
  const cur = day.find((x) => x.s <= sc.now && sc.now < x.e) ?? null;
  return { low, high, cur, day };
}

export default function Hero() {
  const { places, place, setKey } = usePlace();
  const key = place.key;
  const [mode, setMode] = useState<Mode>("cheapest");
  const sc = place.scene;
  const tz = sc.timeZone;
  const { low, high, cur, day } = useMemo(() => marks(sc), [sc]);
  const u = sc.unit === "ct" ? " ct" : sc.unit;
  const dish = sc.runs.find((r) => r.id === "dishwasher");
  const all = sc.runs.reduce((a, r) => a + r.cost, 0);
  const allTypical = sc.runs.reduce((a, r) => a + r.costTypical, 0);

  // The three keys re-plan the same dishwasher from the same prices.
  const runs = useMemo(() => {
    if (!dish) return null;
    const cheapest = { start: dish.start, end: dish.end, cost: dish.cost };
    const green = greenest(sc.slots, sc.now, dish.end > sc.now ? Math.max(dish.end, sc.now + 10 * 3600_000) : sc.now + 12 * 3600_000);
    const now = costAt(sc.slots, sc.now);
    return { cheapest, greenest: green, now };
  }, [dish, sc]);
  // A place with no carbon forecast (or no price for "now") falls back to the cheapest run, and says so.
  const shown: Mode = runs && ((mode === "greenest" && runs.greenest) || (mode === "now" && runs.now)) ? mode : "cheapest";
  useEffect(() => setMode((m) => (m === shown ? m : "cheapest")), [key, shown]);
  const pick = runs ? (shown === "greenest" ? runs.greenest : shown === "now" ? runs.now : runs.cheapest) ?? runs.cheapest : null;
  const label = shown === "greenest" ? "greenest" : shown === "now" ? "start now" : "cheapest by morning";
  const vs = dish ? dish.costTypical : 0;
  const hourIn = (t: number) => Number(hhmm(t, tz).slice(0, 2));
  const when = (t: number) => {
    const h = hourIn(t);
    return h >= 18 || h < 6 ? " tonight" : "";
  };
  const evening = hourIn(sc.now) >= 17 || hourIn(sc.now) < 5;
  const dayOf = (t: number) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric" }).format(new Date(t));
  // The headline follows the pressed key, always with a day word, and never a doubled full stop.
  const sentence = (t: number) => {
    if (shown === "now" || t - sc.now < 15 * 60_000) return `In ${place.label}, run the dishwasher now.`;
    const day = when(t) || (dayOf(t) === dayOf(sc.now) ? " today" : " tomorrow");
    const verb = shown === "greenest" ? "the cleanest start for the dishwasher is" : "run the dishwasher at";
    return `In ${place.label}, ${verb} ${spoken(t, tz)}${day}.`;
  };
  const hourly = /comed/i.test(sc.tariff);
  const lowInRun = !!low && !!pick && low.start >= pick.start && low.start < pick.end;
  const status = dish && pick ? `${place.label}: run the dishwasher at ${hhmm(pick.start, tz)}, ${money(pick.cost, sc)}. Cheapest half hour ${low ? hhmm(low.start, tz) : "unknown"}.` : "";
  const bars = day.slice(0, 48).map((x) => ({ p: x.p, on: !!pick && x.s >= pick.start - 900_000 && x.s < pick.end }));

  return (
    <section className={s.hero} aria-labelledby="hero-title">
      <p className="srOnly" role="status">
        {status}
      </p>
      <div className={s.sky} aria-hidden>
        <span className={s.moon} />
      </div>
      <div className={`shell ${s.grid}`}>
        <div className={s.copy}>
          <p className={s.kicker}>
            <span className={s.pulse} aria-hidden />
            An Alexa+ add-on, on live {sc.tariff} prices for {place.label}
          </p>
          <h1 id="hero-title" className={`serif ${s.title}`}>
            Power is cheapest at <em>low tide</em>.{" "}
            {pick ? sentence(pick.start) : null}
          </h1>
          <p className={s.lede}>
            Ask Alexa when to run the dishwasher. Lowtide reads every {hourly ? "hourly" : "half-hourly"} electricity price and the grid&apos;s
            carbon forecast, and answers with the cheapest time that still finishes when you need it.
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

        {dish && pick && (
          <div className={s.panel}>
            <Lcd
              size="lg"
              top={`Dishwasher, eco 3 h, ${label}`}
              big={hhmm(pick.start, tz)}
              foot={`${money(pick.cost, sc)}${vs > pick.cost + 0.5 ? `, not ${money(vs, sc)}` : vs < pick.cost - 0.5 ? `, ${money(pick.cost - vs, sc)} over a typical time` : ""}`}
              footRight={`Ends ${hhmm(pick.end, tz)}`}
              bars={bars}
              label={`The dishwasher in ${place.label}, ${label}: start at ${hhmm(pick.start, tz)}, ${money(pick.cost, sc)}`}
            />
            <div className={s.keys} role="group" aria-label="Plan the dishwasher for">
              <button type="button" aria-pressed={shown === "cheapest"} onClick={() => setMode("cheapest")}>
                Cheapest<small>done by morning</small>
              </button>
              <button type="button" aria-pressed={shown === "greenest"} onClick={() => setMode("greenest")} disabled={!runs?.greenest} title={runs?.greenest ? undefined : "No carbon forecast is published here"}>
                Greenest<small>{runs?.greenest ? "lowest carbon" : "no forecast here"}</small>
              </button>
              <button type="button" aria-pressed={shown === "now"} onClick={() => setMode("now")} disabled={!runs?.now}>
                Start now<small>{cur ? `${cur.p.toFixed(1)}${u}/kWh` : "now"}</small>
              </button>
            </div>
            <p className={s.panelNote}>
              A 3-hour eco run, {hhmm(pick.start, tz)} to {hhmm(pick.end, tz)}
              {lowInRun && low ? `, around low tide at ${hhmm(low.start, tz)}` : ""}. {money(pick.cost, sc)}, against {money(vs, sc)} at a typical
              time (the average start). Press a key to re-plan it.
            </p>
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
          run={pick ? { start: pick.start, end: pick.end, label: `Dishwasher ${hhmm(pick.start, tz)}–${hhmm(pick.end, tz)}` } : null}
          label={`The next 24 hours of electricity prices in ${place.label} as a tide: high water is dear, low water is cheap. Cheapest half hour at ${low ? hhmm(low.start, tz) : "unknown"}.`}
        />
        <dl className={s.facts}>
          <div>
            <dt>Now</dt>
            <dd className="num">{cur ? `${cur.p.toFixed(1)}${u}` : "—"}</dd>
          </div>
          <div>
            <dt>Cheapest {hourly ? "hour" : "half hour"}</dt>
            <dd className={`num ${s.cheap}`}>
              {low ? hhmm(low.start, tz) : "—"}
              {low && <small> {low.p.toFixed(1)}{u}</small>}
            </dd>
          </div>
          <div>
            <dt>Dearest {hourly ? "hour" : "half hour"}</dt>
            <dd className="num">
              {high ? hhmm(high.start, tz) : "—"}
              {high && <small> {high.p.toFixed(1)}{u}</small>}
            </dd>
          </div>
          <div>
            <dt>{evening ? "Tonight\u2019s" : "Next"} {sc.runs.length} loads, planned</dt>
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
