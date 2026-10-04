"use client";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import type { SceneData } from "@/lib/live";
import { money } from "@/lib/format";
import { hhmm } from "@/views/clock";
import s from "./picker.module.css";
import WhenNear from "./WhenNear";

const DayObject = dynamic(() => import("./object/DayObject"), { ssr: false, loading: () => <div style={{ height: "100%" }} /> });

type Load = { id: string; name: string; kwh: number; minutes: number; icon: React.ReactNode };

const LOADS: Load[] = [
  { id: "dishwasher", name: "Dishwasher", kwh: 0.9, minutes: 180, icon: <DishIcon /> },
  { id: "washing", name: "Washing", kwh: 0.8, minutes: 150, icon: <WashIcon /> },
  { id: "dryer", name: "Tumble dryer", kwh: 2.5, minutes: 120, icon: <DryIcon /> },
  { id: "ev", name: "Car", kwh: 22, minutes: 180, icon: <CarIcon /> },
  { id: "water", name: "Hot water", kwh: 6, minutes: 120, icon: <WaterIcon /> },
];

/** Cost of running `kwh` evenly over [start, start + minutes), or null where prices aren't published. */
function cost(slots: SceneData["slots"], start: number, minutes: number, kwh: number) {
  const end = start + minutes * 60_000;
  let c = 0;
  let covered = 0;
  for (const x of slots) {
    const a = Math.max(start, x.s);
    const b = Math.min(end, x.e);
    if (b > a) {
      c += (kwh * (b - a)) / (end - start) * x.p;
      covered += b - a;
    }
  }
  return covered >= end - start - 1000 ? c : null;
}

export default function AppliancePicker({ scene }: { scene: SceneData }) {
  const [id, setId] = useState("dishwasher");
  const load = LOADS.find((l) => l.id === id)!;
  const tz = scene.timeZone;

  const plan = useMemo(() => {
    const now = scene.now;
    const horizon = now + 24 * 3600_000;
    let best: { start: number; c: number } | null = null;
    let worst: { start: number; c: number } | null = null;
    for (let t = Math.ceil(now / 1800_000) * 1800_000; t + load.minutes * 60_000 <= horizon; t += 1800_000) {
      const c = cost(scene.slots, t, load.minutes, load.kwh);
      if (c == null) continue;
      if (!best || c < best.c) best = { start: t, c };
      if (!worst || c > worst.c) worst = { start: t, c };
    }
    const nowC = cost(scene.slots, now, load.minutes, load.kwh);
    return { best, worst, nowC };
  }, [load, scene]);

  const highlight = useMemo(
    () => (plan.best ? { start: plan.best.start, end: plan.best.start + load.minutes * 60_000 } : null),
    [plan, load],
  );

  return (
    <div className={s.wrap}>
      <div className={s.loads} role="radiogroup" aria-label="Appliance">
        {LOADS.map((l) => (
          <button key={l.id} type="button" role="radio" aria-checked={l.id === id} onClick={() => setId(l.id)} className={s.load}>
            <span className={s.icon}>{l.icon}</span>
            <span>{l.name}</span>
          </button>
        ))}
      </div>
      <div className={s.body}>
        <div className={s.clock}>
          <WhenNear>
          <DayObject
            slots={scene.slots}
            now={scene.now}
            timeZone={tz}
            unit={scene.unit}
            highlight={highlight}
            label={`The next 24 hours in ${scene.region}; the ${load.name.toLowerCase()}'s cheapest stretch is cut in cobalt, starting ${plan.best ? hhmm(plan.best.start, tz) : "—"}.`}
          />
          </WhenNear>
        </div>
        <dl className={s.facts}>
          <div>
            <dt>Start</dt>
            <dd className={s.cheap}>{plan.best ? hhmm(plan.best.start, tz) : "—"}</dd>
          </div>
          <div>
            <dt>Switched on now</dt>
            <dd className={s.dear}>{plan.nowC != null ? money(plan.nowC, scene) : "—"}</dd>
          </div>
          <div>
            <dt>At the cheapest time</dt>
            <dd className={s.cheap}>{plan.best ? money(plan.best.c, scene) : "—"}</dd>
          </div>
          <div>
            <dt>A year of days like today</dt>
            <dd>{plan.best && plan.nowC != null ? money(Math.max(0, plan.nowC - plan.best.c) * 365, scene) : "—"}</dd>
          </div>
        </dl>
      </div>
      <p className={s.note}>
        {load.kwh} kWh over {Math.floor(load.minutes / 60)} h{load.minutes % 60 ? ` ${load.minutes % 60}` : ""}, priced with the live {scene.tariff} rates for {scene.region}. The
        year figure assumes every day is like today, so read it as a rough guide.
      </p>
    </div>
  );
}

function DishIcon() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden>
      <rect x="7" y="5" width="26" height="30" rx="3" />
      <line x1="7" y1="12" x2="33" y2="12" />
      <circle cx="12" cy="8.5" r="1.2" />
      <path d="M13 20 h14 M13 25 h14 M15 30 h10" />
    </svg>
  );
}
function WashIcon() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden>
      <rect x="7" y="5" width="26" height="30" rx="3" />
      <circle cx="20" cy="23" r="7.5" />
      <path d="M15.5 23 q4.5 -4 9 0" />
      <circle cx="12" cy="9" r="1.2" />
    </svg>
  );
}
function DryIcon() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden>
      <rect x="7" y="5" width="26" height="30" rx="3" />
      <circle cx="20" cy="23" r="7.5" />
      <path d="M17 20 c2 2 -2 4 0 6 M21 20 c2 2 -2 4 0 6" />
      <line x1="24" y1="9" x2="29" y2="9" />
    </svg>
  );
}
function CarIcon() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden>
      <path d="M5 27 v-5 l4 -7 h17 l6 7 h2 v5 z" />
      <circle cx="12" cy="28" r="3.2" />
      <circle cx="28" cy="28" r="3.2" />
      <path d="M21 9 l-3 5 h4 l-3 5" />
    </svg>
  );
}
function WaterIcon() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden>
      <rect x="12" y="4" width="16" height="32" rx="8" />
      <path d="M16 26 c0 -3 4 -4 4 -8 c0 4 4 5 4 8 a4 4 0 0 1 -8 0 z" />
    </svg>
  );
}
