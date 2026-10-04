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
          <Link href="/connect">Add to Claude or ChatGPT</Link>
          <Link href="/tables">Tide tables</Link>
        </nav>
      </div>
    </header>
  );
}

/** A tidal curve dipping to low water, with the "now" mark at the trough. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect x="1" y="1" width="30" height="30" rx="3" fill="var(--ink)" />
      <path d="M3 12 C 8 12, 9 22, 16 22 S 24 12, 29 12 L 29 29 L 3 29 Z" fill="var(--shoal)" />
      <path d="M3 12 C 8 12, 9 22, 16 22 S 24 12, 29 12" fill="none" stroke="var(--chart)" strokeWidth="1.6" />
      <line x1="16" y1="5" x2="16" y2="29" stroke="var(--magenta)" strokeWidth="2" />
    </svg>
  );
}
