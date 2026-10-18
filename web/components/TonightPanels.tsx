import type { SceneData } from "@/lib/live";
import { money } from "@/lib/format";
import { Knob, Lcd } from "./Lcd";
import s from "./tonightpanels.module.css";

/**
 * Tonight in one household, as the machines would show it: each everyday load planned into the cheapest
 * stretch that still finishes by morning, its delay-start knob turned to the hours until it starts.
 */
const PER_WEEK: Record<string, number> = { dishwasher: 7, "washing-machine": 4, "hot-water": 7, ev: 2 };
const PROGRAMME: Record<string, string> = { dishwasher: "eco 3 h", "washing-machine": "40 eco, 2.5 h", "hot-water": "immersion, 2 h", ev: "7.4 kW, 3 h" };

function hhmm(t: number, tz: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
}

export default function TonightPanels({ scene, place }: { scene: SceneData; place: string }) {
  const tz = scene.timeZone;
  const hour = Number(hhmm(scene.now, tz).slice(0, 2));
  const night = hour >= 17 || hour < 5;
  const runs = [...scene.runs].sort((a, b) => a.start - b.start);
  if (!runs.length) return null;
  const yearly = runs.reduce((a, r) => a + Math.max(0, r.costTypical - r.cost) * (PER_WEEK[r.id] ?? 7) * 52, 0);
  return (
    <div className={s.wrap}>
      <ul className={s.grid}>
        {runs.map((r) => {
          const saved = Math.max(0, r.costTypical - r.cost);
          const delay = Math.max(0, (r.start - scene.now) / 3600_000);
          const name = r.label.charAt(0).toUpperCase() + r.label.slice(1);
          return (
            <li key={r.id} className={s.unit}>
              <div className={s.head}>
                <h3>{name}</h3>
                <span>{PROGRAMME[r.id] ?? ""}</span>
              </div>
              <Lcd
                size="md"
                top="Start"
                topRight={`Done by ${hhmm(r.end, tz)}`}
                big={hhmm(r.start, tz)}
                foot={saved > 0 ? `${money(r.cost, scene)}, not ${money(r.costTypical, scene)}` : money(r.cost, scene)}
                label={`${name}: start at ${hhmm(r.start, tz)}, done by ${hhmm(r.end, tz)}, ${money(r.cost, scene)}`}
              />
              <div className={s.foot}>
                <Knob hours={delay} size={72} label={`Delay start: ${delay.toFixed(1)} hours`} />
                <div>
                  <span className="mono">Delay start {delay < 1 ? "under 1 h" : `${Math.round(delay)} h`}</span>
                  <p>
                    {money(saved * (PER_WEEK[r.id] ?? 7) * 52, scene)} a year,{" "}
                    {PER_WEEK[r.id] === 7 ? "every night" : `${PER_WEEK[r.id]} nights a week`}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <p className={s.fine}>
        {place} on {scene.tariff}, prices read at {hhmm(scene.now, tz)}. Each load finishes {night ? "by morning" : "within the next day"}. A typical time is the average of
        every start in the next 24 hours, so the yearly figures ({money(yearly, scene)} for all four) are what moving them saves over
        running them whenever, not over the evening peak, if every {night ? "night looked like tonight" : "day looked like this one"}.
      </p>
    </div>
  );
}
