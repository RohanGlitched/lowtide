"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import s from "./chrome.module.css";

const LINKS = [
  { href: "/echo", long: "Try it on Echo", short: "Echo" },
  { href: "/tables", long: "Today's tides", short: "Tides" },
  { href: "/connect", long: "Add to your assistant", short: "Connect" },
];

/** Main navigation; the page you're on is marked. */
export default function Nav() {
  const path = usePathname();
  return (
    <nav className={s.nav} aria-label="Main">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} prefetch={false} aria-current={path === l.href ? "page" : undefined}>
          <span className={s.long}>{l.long}</span>
          <span className={s.short}>{l.short}</span>
        </Link>
      ))}
      <a className={s.source} href="https://github.com/RohanGlitched/lowtide" rel="noopener">
        <span className={s.long}>Source</span>
        <span className={s.short}>Code</span>
      </a>
    </nav>
  );
}
