"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import s from "./chrome.module.css";

const LINKS = [
  { href: "/#how", label: "How it works", match: "#how" },
  { href: "/tables", label: "Tides", match: "/tables" },
  { href: "/connect", label: "Add to your assistant", match: "/connect" },
];

/** The header's links, a live price chip, the main action, and a sheet on phones. */
export default function Nav({ price }: { price: string | null }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <nav className={s.nav} aria-label="Main">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} prefetch={false} aria-current={path === l.match ? "page" : undefined}>
            {l.label}
          </Link>
        ))}
        <a href="https://github.com/RohanGlitched/lowtide" rel="noopener">
          Source
        </a>
      </nav>
      <div className={s.right}>
        {price && (
          <Link href="/tables" prefetch={false} className={s.chip} title="London's Octopus Agile price this half hour">
            <span className={s.dot} aria-hidden />
            <span className={s.chipLabel}>London now</span>
            <b>{price}</b>
          </Link>
        )}
        <Link href="/echo" prefetch={false} className={`btn btn-primary ${s.cta}`} aria-current={path === "/echo" ? "page" : undefined}>
          Ask Alexa
        </Link>
        <button type="button" className={s.menu} aria-expanded={open} aria-controls="sheet" onClick={() => setOpen((o) => !o)}>
          <span className="srOnly">{open ? "Close menu" : "Menu"}</span>
          <i aria-hidden />
          <i aria-hidden />
        </button>
      </div>
      <div id="sheet" className={s.sheet} data-open={open ? "yes" : undefined} hidden={!open}>
        <Link href="/" prefetch={false}>Tonight</Link>
        <Link href="/echo" prefetch={false}>Ask Alexa on the Echo</Link>
        <Link href="/#how" prefetch={false}>How it works</Link>
        <Link href="/tables" prefetch={false}>Tides, region by region</Link>
        <Link href="/connect" prefetch={false}>Add to your assistant</Link>
        <a href="https://github.com/RohanGlitched/lowtide" rel="noopener">
          Source on GitHub
        </a>
        {price && <p className={s.sheetPrice}>London now: {price} per kWh</p>}
      </div>
    </>
  );
}
