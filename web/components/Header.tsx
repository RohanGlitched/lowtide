import Link from "next/link";
import Nav from "./Nav";
import { getTide } from "@/lib/grid";
import s from "./chrome.module.css";

/** London's price this half hour, for the header's live chip; nothing if the feed is slow or down. */
async function priceNow(): Promise<string | null> {
  try {
    const tide = await Promise.race([getTide("SE1 7PB"), new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
    if (!tide) return null;
    const now = Date.now();
    const cur = tide.slots.find((x) => x.start <= now && now < x.end);
    return cur ? `${cur.price.toFixed(1)}p` : null;
  } catch {
    return null;
  }
}

export default async function Header() {
  const now = await priceNow();
  return (
    <header className={s.header}>
      <div className={`shell ${s.bar}`}>
        <Link href="/" className={s.brand} aria-label="Lowtide home" prefetch={false}>
          <Mark />
          <span>Lowtide</span>
        </Link>
        <Nav price={now} />
      </div>
    </header>
  );
}

/** A moon over a wave: low tide under a night sky. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <circle cx="16" cy="11.5" r="6.5" fill="#f3f1e6" />
      <circle cx="19.2" cy="9.4" r="5.6" fill="#05070e" />
      <path d="M2 23.5c3.5 0 3.5-3 7-3s3.5 3 7 3 3.5-3 7-3 3.5 3 7 3" fill="none" stroke="#8fd6ff" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M6 28c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2" fill="none" stroke="#8fd6ff" strokeOpacity="0.45" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
