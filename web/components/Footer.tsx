import Link from "next/link";
import { Mark } from "./Header";
import s from "./footer.module.css";

const GH = "https://github.com/RohanGlitched/lowtide";

const COLUMNS: { title: string; links: { label: string; href: string; ext?: boolean }[] }[] = [
  {
    title: "Use it",
    links: [
      { label: "Ask Alexa on the Echo", href: "/echo" },
      { label: "Today's tides, region by region", href: "/tables" },
      { label: "Add to Claude or ChatGPT", href: "/connect" },
      { label: "Sign in with OAuth", href: "/connect#account" },
    ],
  },
  {
    title: "Build on it",
    links: [
      { label: "Source on GitHub", href: GH, ext: true },
      { label: "The Lowtide agent skill", href: `${GH}/blob/main/skills/lowtide/SKILL.md`, ext: true },
      { label: "Countertop, the MCP test bench", href: "https://d124pgg01fg3le.cloudfront.net", ext: true },
      { label: "Our fix for Vercel's MCP handler", href: "https://github.com/vercel-labs/mcp-handler/pull/200", ext: true },
      { label: "Friction log", href: `${GH}/blob/main/FRICTION.md`, ext: true },
    ],
  },
  {
    title: "Data sources",
    links: [
      { label: "Octopus Energy Agile, Britain", href: "https://octopus.energy/smart/agile/", ext: true },
      { label: "ComEd Hourly Pricing, Illinois", href: "https://hourlypricing.comed.com/", ext: true },
      { label: "EPEX day-ahead via aWATTar, Germany", href: "https://www.awattar.de/", ext: true },
      { label: "NESO carbon intensity forecast", href: "https://carbonintensity.org.uk/", ext: true },
    ],
  },
];

const RUNS_ON = ["AWS Lambda", "Amazon CloudFront", "Amazon Bedrock, Nova Micro", "Amazon Polly", "Amazon S3", "EventBridge Scheduler", "Amazon CloudWatch"];

const CHANGES: { date: string; text: string }[] = [
  { date: "18 Oct", text: "Any MCP client can sign in with OAuth 2.1. “Seven” means the next seven the run can still make, and Alexa says it back." },
  { date: "18 Oct", text: "Sent an opt-in CORS option upstream to Vercel's MCP handler, the fix Lowtide needed for browser clients." },
  { date: "15 Oct", text: "Moved to AWS: Lambda behind CloudFront, Polly for the voice, and a nightly plan from EventBridge Scheduler." },
  { date: "7 Oct", text: "Amazon Nova Micro on Bedrock now understands the Echo, with a phrase router if it's unavailable." },
];

export default function Footer() {
  return (
    <footer className={s.footer}>
      <div className={`shell ${s.top}`}>
        <div className={s.brand}>
          <Link href="/" prefetch={false} className={s.logo} aria-label="Lowtide home">
            <Mark size={36} />
            <span>Lowtide</span>
          </Link>
          <p className={s.line}>Run it when power is cheapest.</p>
          <p className={s.about}>
            An MCP server for Alexa+ that reads every half-hourly electricity price and the grid&apos;s carbon forecast, and tells you
            when to run the dishwasher, the washing, the hot water and the car.
          </p>
        </div>
        <nav className={s.cols} aria-label="Footer">
          {COLUMNS.map((c) => (
            <div key={c.title}>
              <h2>{c.title}</h2>
              <ul>
                {c.links.map((l) => (
                  <li key={l.label}>
                    {l.ext ? (
                      <a href={l.href} rel="noopener">
                        {l.label}
                      </a>
                    ) : (
                      <Link href={l.href} prefetch={false}>
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div>
            <h2>Runs on AWS</h2>
            <ul className={s.plain}>
              {RUNS_ON.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        </nav>
      </div>

      <div className={`shell ${s.log}`}>
        <h2>What changed lately</h2>
        <ol>
          {CHANGES.slice(0, 2).map((c, i) => (
            <li key={i}>
              <time>{c.date}</time>
              <p>{c.text}</p>
            </li>
          ))}
        </ol>
      </div>

      <svg className={s.wave} viewBox="0 0 1200 40" preserveAspectRatio="none" aria-hidden>
        <path d="M0 24 C100 24 100 10 200 10 S300 30 400 30 S500 14 600 14 S700 32 800 32 S900 12 1000 12 S1100 24 1200 24" />
      </svg>

      <div className={`shell ${s.legal}`}>
        <p>Built by Rohan Borade for Amazon&apos;s Build, Ship, Shape hackathon, Alexa+ track, 2026. MIT licensed.</p>
        <p>Lowtide is independent and not affiliated with Amazon, Octopus Energy or ComEd. Prices are published tariffs, not advice.</p>
      </div>
    </footer>
  );
}
