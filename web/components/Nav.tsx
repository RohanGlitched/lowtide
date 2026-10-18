"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
  const menuRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const followed = useRef(false);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) {
      // Back to the button that opened it, unless a link was followed.
      if (wasOpen.current && !followed.current) menuRef.current?.focus();
      followed.current = false;
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    // While the sheet is open the page behind it neither scrolls nor takes focus.
    const behind = [document.querySelector("main"), document.querySelector("footer")].filter((x): x is HTMLElement => !!x);
    behind.forEach((x) => x.setAttribute("inert", ""));
    document.documentElement.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    window.addEventListener("hashchange", close);
    return () => {
      behind.forEach((x) => x.removeAttribute("inert"));
      document.documentElement.style.overflow = "";
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("hashchange", close);
    };
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
          <Link href="/tables" prefetch={false} className={s.chip} title="London's Octopus Agile price this half hour" aria-label={`London now: ${price} per kWh. See every region`}>
            <span className={s.dot} aria-hidden />
            <span className={s.chipLabel}>London now</span>
            <b>{price}</b>
          </Link>
        )}
        <Link href="/echo" prefetch={false} className={`btn btn-primary ${s.cta}`} aria-current={path === "/echo" ? "page" : undefined}>
          Ask Alexa
        </Link>
        <button ref={menuRef} type="button" className={s.menu} aria-expanded={open} aria-controls="sheet" onClick={() => setOpen((o) => !o)}>
          <span className="srOnly">{open ? "Close menu" : "Menu"}</span>
          <i aria-hidden />
          <i aria-hidden />
        </button>
      </div>
      {/* Any link in the sheet closes it, including ones to a part of the page you're already on. */}
      <div id="sheet" className={s.sheet} data-open={open ? "yes" : undefined} hidden={!open} onClick={(e) => {
          if (!(e.target as HTMLElement).closest("a")) return;
          // Unlock the page first, so the link can scroll it.
          followed.current = true;
          document.documentElement.style.overflow = "";
          document.querySelectorAll("main, footer").forEach((x) => x.removeAttribute("inert"));
          setOpen(false);
        }}
      >
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
