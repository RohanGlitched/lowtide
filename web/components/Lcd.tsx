import s from "./lcd.module.css";

/**
 * An appliance's LCD: the answer as a machine would show it. A top line (what and where), the big readout,
 * a foot line, and optionally the night's prices as a bar graph with the run lit. Signal orange lives here only.
 */
export function Lcd({
  top,
  topRight,
  big,
  foot,
  footRight,
  bars,
  size = "md",
  label,
}: {
  top: string;
  topRight?: string;
  big: string;
  foot?: string;
  footRight?: string;
  bars?: { p: number; on: boolean }[];
  size?: "sm" | "md" | "lg";
  label?: string;
}) {
  const ps = bars?.map((b) => b.p) ?? [];
  const lo = Math.min(...ps, 0);
  const hi = Math.max(...ps, 1);
  return (
    <div className={`${s.lcd} ${s[size]}`} role={label ? "img" : undefined} aria-label={label}>
      <div className={s.row}>
        <span>{top}</span>
        {topRight && <span>{topRight}</span>}
      </div>
      <div className={s.big}>{big}</div>
      {(foot || footRight) && (
        <div className={s.row}>
          <span>{foot}</span>
          {footRight && <span>{footRight}</span>}
        </div>
      )}
      {bars && bars.length > 0 && (
        <div className={s.bars} aria-hidden>
          {bars.map((b, i) => (
            <i key={i} className={b.on ? s.on : ""} style={{ height: `${Math.round(14 + (86 * (b.p - lo)) / Math.max(0.01, hi - lo))}%` }} />
          ))}
        </div>
      )}
    </div>
  );
}

/** A delay-start knob: ticks for 0 to 9 hours, the pointer at `hours`. Decorative unless labelled. */
export function Knob({ hours, size = 200, label }: { hours: number; size?: number; label?: string }) {
  const C = 100;
  const ticks = [];
  for (let i = 0; i <= 27; i++) {
    const a = ((-135 + i * 10) * Math.PI) / 180;
    const major = i % 3 === 0;
    const r0 = major ? 80 : 85;
    const r1 = 93;
    const lit = i <= Math.round(hours * 3);
    ticks.push(
      <line
        key={i}
        x1={Math.round((C + r0 * Math.sin(a)) * 100) / 100}
        y1={Math.round((C - r0 * Math.cos(a)) * 100) / 100}
        x2={Math.round((C + r1 * Math.sin(a)) * 100) / 100}
        y2={Math.round((C - r1 * Math.cos(a)) * 100) / 100}
        stroke={lit ? "#ff6a33" : "#3a4052"}
        strokeWidth={major ? 3 : 1.6}
        strokeLinecap="round"
      />,
    );
  }
  const deg = -135 + Math.min(9, Math.max(0, hours)) * 30;
  return (
    <div className={s.knob} style={{ width: size, height: size }} role={label ? "img" : undefined} aria-label={label}>
      <svg viewBox="0 0 200 200" aria-hidden>
        {ticks}
      </svg>
      <div className={s.face}>
        <span className={s.pointer} style={{ transform: `rotate(${deg}deg)` }} />
      </div>
    </div>
  );
}
