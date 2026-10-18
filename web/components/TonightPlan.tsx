import type { SceneData } from "@/lib/live";
import { money } from "@/lib/format";
import s from "./tonight.module.css";

/**
 * Tonight in one household, planned: each everyday load placed in the cheapest stretch that still finishes by
 * morning, over the night's half-hourly prices. The same planning the nightly schedule does for every household.
 */
const PER_WEEK: Record<string, number> = { dishwasher: 7, "washing-machine": 4, "hot-water": 7, ev: 2 };

function hhmm(t: number, tz: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
}
const r2 = (n: number) => Math.round(n * 100) / 100;

export default function TonightPlan({ scene, place }: { scene: SceneData; place: string }) {
  const tz = scene.timeZone;
  const runs = [...scene.runs].sort((a, b) => a.start - b.start);
  if (!runs.length) return null;
  const t0 = Math.floor(scene.now / 1800_000) * 1800_000;
  const lastRun = Math.max(...runs.map((r) => r.end));
  const lastSlot = Math.max(...scene.slots.map((x) => x.e));
  const t1 = Math.min(lastSlot, Math.max(lastRun + 3 * 3600_000, t0 + 12 * 3600_000));
  const slots = scene.slots.filter((x) => x.e > t0 && x.s < t1);
  const span = t1 - t0;
  const x = (t: number) => r2(((Math.min(Math.max(t, t0), t1) - t0) / span) * 1000);
  const prices = slots.map((x) => x.p);
  const lo = Math.min(0, ...prices);
  const hi = Math.max(...prices);
  const H = 180;
  const y = (p: number) => r2(H - ((p - lo) / Math.max(0.01, hi - lo)) * (H - 12));
  const sorted = [...prices].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)] ?? lo;
  const q3 = sorted[Math.floor(sorted.length * 0.75)] ?? hi;
  // Hour marks every 3 hours, on the hour.
  const marks: number[] = [];
  for (let t = Math.ceil(t0 / 3600_000) * 3600_000; t < t1; t += 3600_000) {
    if (Number(hhmm(t, tz).slice(0, 2)) % 3 === 0) marks.push(t);
  }
  const yearly = runs.reduce((a, r) => a + Math.max(0, r.costTypical - r.cost) * ((PER_WEEK[r.id] ?? 7) * 52), 0);

  return (
    <div className={s.wrap}>
      <figure className={s.chart} aria-label={`Half-hourly prices in ${place} from ${hhmm(t0, tz)} to ${hhmm(t1, tz)}, with each load's planned run marked.`}>
        <svg viewBox={`0 0 1000 ${H + 34}`} preserveAspectRatio="none" className={s.svg}>
          {slots.map((sl) => {
            const a = x(sl.s);
            const b = x(sl.e);
            const tone = sl.p <= q1 ? s.cheap : sl.p >= q3 ? s.dear : s.mid;
            return <rect key={sl.s} x={a + 1} y={y(sl.p)} width={Math.max(1, b - a - 2)} height={r2(H - y(sl.p))} rx="2" className={tone} />;
          })}
          <line x1="0" x2="1000" y1={H} y2={H} className={s.base} />
          <line x1={x(scene.now)} x2={x(scene.now)} y1="0" y2={H} className={s.now} />
        </svg>
        <div className={s.axis} aria-hidden>
          <span style={{ left: `${x(scene.now) / 10}%` }} className={s.nowLabel}>
            now
          </span>
          {marks.map((m) => (
            <span key={m} style={{ left: `${x(m) / 10}%` }}>
              {hhmm(m, tz)}
            </span>
          ))}
        </div>
        <ol className={s.lanes}>
          {runs.map((r) => (
            <li key={r.id}>
              <span className={s.laneName}>{r.label}</span>
              <span className={s.track}>
                <span className={s.bar} style={{ left: `${x(r.start) / 10}%`, width: `${Math.max(1.2, (x(r.end) - x(r.start)) / 10)}%` }}>
                  <span className={`${s.barTime} ${x(r.end) > 760 ? s.barTimeLeft : ""}`}>
                    {hhmm(r.start, tz)} to {hhmm(r.end, tz)}
                  </span>
                </span>
              </span>
            </li>
          ))}
        </ol>
      </figure>

      <dl className={s.list}>
        {runs.map((r) => {
          const saved = Math.max(0, r.costTypical - r.cost);
          return (
            <div key={r.id}>
              <dt>{r.label}</dt>
              <dd className={s.when}>{hhmm(r.start, tz)}</dd>
              <dd className={s.cost}>
                {money(r.cost, scene)}
                {saved > 0 ? <span> instead of {money(r.costTypical, scene)}</span> : <span>, as cheap as a typical time</span>}
              </dd>
              <dd className={s.year}>
                {money(saved * (PER_WEEK[r.id] ?? 7) * 52, scene)} a year, {PER_WEEK[r.id] === 7 ? "daily" : `${PER_WEEK[r.id]} times a week`}
              </dd>
            </div>
          );
        })}
      </dl>
      <p className={s.fine}>
        {place} on {scene.tariff}, prices read at {hhmm(scene.now, tz)}. Every load finishes by morning. A typical time is the average
        of every start in the next 24 hours, so the yearly figures ({money(yearly, scene)} for all four) are what moving them saves over
        running them whenever, not over the evening peak, if every day looked like today.
      </p>
    </div>
  );
}
