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
        <p className={s.footLinks}>
          <Link href="/echo">Echo simulator</Link>
          <Link href="/connect">MCP endpoint</Link>
          <Link href="/tables">Tide tables</Link>
          <a href="https://github.com/RohanGlitched/lowtide">Source on GitHub</a>
        </p>
      </div>
    </footer>
  );
}
