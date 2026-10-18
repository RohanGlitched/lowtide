import Link from "next/link";
import Nav from "./Nav";
import s from "./chrome.module.css";

export default function Header() {
  return (
    <header className={s.header}>
      <div className={`shell ${s.bar}`}>
        <Link href="/" className={s.brand} aria-label="Lowtide home" prefetch={false}>
          <Mark />
          <span>Lowtide</span>
        </Link>
        <Nav />
      </div>
    </header>
  );
}

/** The object seen from above: a ring of fins, the cheapest few in cobalt. */
export function Mark({ size = 26, dark = false }: { size?: number; dark?: boolean }) {
  const ink = dark ? "#e9ebee" : "#16181b";
  const fins = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2;
    const k = (Math.cos(a - 2.4) + 1) / 2;
    const r0 = 6.2;
    const r1 = 8.6 + k * 5.4;
    return (
      <line
        key={i}
        x1={16 + r0 * Math.sin(a)}
        y1={16 - r0 * Math.cos(a)}
        x2={16 + r1 * Math.sin(a)}
        y2={16 - r1 * Math.cos(a)}
        stroke={k < 0.22 ? (dark ? "#5b73ff" : "#2340ff") : ink}
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    );
  });
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      {fins}
      <circle cx="16" cy="16" r="2.4" fill={ink} />
    </svg>
  );
}
