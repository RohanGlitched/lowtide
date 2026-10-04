import Link from "next/link";
import s from "./chrome.module.css";

export default function Header() {
  return (
    <header className={s.header}>
      <div className={`shell ${s.bar}`}>
        <Link href="/" className={s.brand} aria-label="Lowtide home">
          <Mark />
          <span>Lowtide</span>
        </Link>
        <nav className={s.nav} aria-label="Main">
          <Link href="/echo">Try it on Echo</Link>
          <Link href="/tables">Today&apos;s tides</Link>
          <Link href="/connect">Add to Claude or ChatGPT</Link>
        </nav>
      </div>
    </header>
  );
}

/** The object seen from above: a ring of fins, the cheapest few in cobalt. */
export function Mark({ size = 26 }: { size?: number }) {
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
        stroke={k < 0.22 ? "#2340ff" : "#16181b"}
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    );
  });
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      {fins}
      <circle cx="16" cy="16" r="2.4" fill="#16181b" />
    </svg>
  );
}
