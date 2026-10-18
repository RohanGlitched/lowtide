import Link from "next/link";
import s from "./chrome.module.css";

export default function Footer() {
  return (
    <footer className={s.footer}>
      <div className={`shell ${s.foot}`}>
        <p>
          Prices: Octopus Energy Agile (Britain), ComEd Hourly Pricing (northern Illinois), EPEX day-ahead via aWATTar
          (Germany). Carbon: National Energy System Operator. Lowtide is independent and not affiliated with Amazon,
          Octopus Energy or ComEd.
        </p>
        <nav className={s.footLinks} aria-label="Footer">
          <Link href="/echo" prefetch={false}>Echo simulator</Link>
          <Link href="/tables" prefetch={false}>Today&apos;s tides</Link>
          <Link href="/connect" prefetch={false}>MCP endpoint</Link>
          <a href="https://github.com/RohanGlitched/lowtide">Source</a>
        </nav>
      </div>
    </footer>
  );
}
