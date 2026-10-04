import Link from "next/link";
import TideChart from "@/components/TideChart";
import CopyField from "@/components/CopyField";
import { homeData, DEMO_PLACE } from "@/lib/live";
import { planResult } from "@/lib/mcp/tools";
import { APPLIANCES } from "@/lib/appliances";
import { clock, dayPart, spokenTime } from "@/lib/grid/time";
import { money, rate } from "@/lib/format";
import { SITE_URL } from "@/lib/site";
import s from "./home.module.css";

export const revalidate = 300;

const TOOLS: [string, string][] = [
  ["get_tide", "The next day of prices and grid carbon, with low and high water."],
  ["check_now", "Whether this half hour is a cheap or dear time to use power, and when it drops."],
  ["plan_appliance", "The cheapest or greenest start for an appliance, optionally finishing by a deadline."],
  ["schedule_run", "Saves the plan for the household, with its saving, once the person agrees."],
  ["list_runs", "What the household has planned."],
  ["cancel_run", "Cancels a planned run."],
  ["get_savings", "Money and CO₂ saved by running at low water instead of when asked."],
  ["set_home", "Sets the postcode or city, which picks the tariff region."],
];

export default async function Home() {
  const d = await homeData();
  const tide = d.london;
  const tz = tide?.region.timeZone ?? "Europe/London";
  const now = Date.now();
  const dish = APPLIANCES[0];
  const answer = tide && d.plan ? planResult(tide, dish, d.plan, now).content[0].text : null;
  const remind = d.plan ? `Done. I'll remind you to run the dishwasher ${dayPart(d.plan.best.start, now, tz)} at ${spokenTime(d.plan.best.start, tz)}.`.replace(/\.\.$/, ".") : null;
  const ratio = d.low && d.high && d.low.avgPrice > 0 ? d.high.avgPrice / d.low.avgPrice : null;

  return (
    <main>
      <section className={s.hero}>
        <div className="shell">
          <h1 className={s.title}>Run it at low tide.</h1>
          <p className={s.lede}>
            Ask Alexa when to run the dishwasher. Lowtide reads tonight&apos;s half-hourly electricity prices and the
            grid&apos;s carbon forecast, and picks the cheapest, cleanest hours to run it.
          </p>
          <div className={s.ctas}>
            <Link href="/echo" className={s.primary}>
              Try it on Echo
            </Link>
            <Link href="/connect" className={s.secondary}>
              Add to Claude or ChatGPT
            </Link>
          </div>
        </div>

        {tide && d.chart ? (
          <figure className={s.heroChart}>
            <TideChart data={d.chart} height={360} label="Live electricity price in London over the next day" />
            <figcaption className="shell">
              <dl className={s.strip}>
                <div>
                  <dt>London · Octopus Agile</dt>
                  <dd>{d.cur ? rate(d.cur.price, tide.region) : "—"} now</dd>
                </div>
                {d.low && (
                  <div>
                    <dt>Low water</dt>
                    <dd>
                      {clock(d.low.start, tz)} · {rate(d.low.avgPrice, tide.region)}
                    </dd>
                  </div>
                )}
                {d.high && (
                  <div>
                    <dt>High water</dt>
                    <dd>
                      {clock(d.high.start, tz)} · {rate(d.high.avgPrice, tide.region)}
                    </dd>
                  </div>
                )}
                <div>
                  <dt>Published by</dt>
                  <dd className={s.small}>Octopus Energy and NESO, read {clock(tide.fetchedAt, tz)}</dd>
                </div>
              </dl>
            </figcaption>
          </figure>
        ) : (
          <div className="shell">
            <p className={s.down}>The live price feed didn&apos;t answer just now. Refresh in a minute.</p>
          </div>
        )}
      </section>

      {answer && (
        <section className={`shell ${s.section} ${s.talk}`}>
          <div>
            <h2>What Alexa says, right now</h2>
            <p className={s.note}>
              Not a script. This exchange was produced a few minutes ago by the same MCP tools Alexa calls, from London&apos;s
              published prices for tonight.
            </p>
          </div>
          <ol className={s.script}>
            <li data-who="you">Alexa, when should I run the dishwasher?</li>
            <li data-who="alexa">{answer}</li>
            <li data-who="you">Yes please.</li>
            <li data-who="alexa">{remind}</li>
          </ol>
        </section>
      )}

      {tide && d.spread && (
        <section className={`shell ${s.section}`}>
          <div className={s.sectionHead}>
            <h2>Same load, same day, different price</h2>
            <p>
              {ratio
                ? `Today in London the dearest hour costs ${ratio.toFixed(1)} times the cheapest. Here is what that means for the things you can move.`
                : "Here is what today's tide means for the things you can move."}
            </p>
          </div>
          <table className={s.table}>
            <thead>
              <tr>
                <th scope="col">Appliance</th>
                <th scope="col">Typical run</th>
                <th scope="col">At low water</th>
                <th scope="col">At high water</th>
                <th scope="col">Difference</th>
              </tr>
            </thead>
            <tbody>
              {d.spread.map(({ appliance: a, low, high }) => (
                <tr key={a.id}>
                  <th scope="row">{a.name.charAt(0).toUpperCase() + a.name.slice(1)}</th>
                  <td>
                    {a.kwh} kWh, {a.note}
                  </td>
                  <td>{low ? `${money(low.cost, tide.region)} at ${clock(low.start, tz)}` : "—"}</td>
                  <td>{high ? `${money(high.cost, tide.region)} at ${clock(high.start, tz)}` : "—"}</td>
                  <td className={s.diff}>{low && high ? money(high.cost - low.cost, tide.region) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className={`shell ${s.section} ${s.how}`}>
        <div className={s.sectionHead}>
          <h2>How it works</h2>
          <p>
            Lowtide is an MCP server, the open standard Alexa+ uses to connect to services. Alexa&apos;s model picks a
            Lowtide tool, Lowtide reads the live feeds, and the answer comes back twice: a sentence to speak and a chart
            (an MCP App) for the Echo Show screen.
          </p>
        </div>
        <ol className={s.flow}>
          <li>
            <h3>You ask</h3>
            <p>&ldquo;Alexa, when should I run the dishwasher? It needs to be done by seven.&rdquo;</p>
          </li>
          <li>
            <h3>Alexa+ calls a tool</h3>
            <p>
              <code>plan_appliance</code> with <code>appliance: dishwasher</code>, <code>finish_by: 07:00</code>, over
              Streamable HTTP.
            </p>
          </li>
          <li>
            <h3>Lowtide reads the tide</h3>
            <p>Half-hourly Agile prices and the regional carbon forecast for your postcode, then tries every start that finishes in time.</p>
          </li>
          <li>
            <h3>Two answers come back</h3>
            <p>A sentence for Alexa to say, and the tide chart with the run marked, drawn on the Echo Show.</p>
          </li>
        </ol>
        <dl className={s.tools}>
          {TOOLS.map(([name, desc]) => (
            <div key={name}>
              <dt>
                <code>{name}</code>
              </dt>
              <dd>{desc}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={`shell ${s.section} ${s.connect}`}>
        <div className={s.sectionHead}>
          <h2>Use it from any MCP client</h2>
          <p>
            Alexa+ integrations are in preview for brands, so the Echo here is simulated. The server is real: add it to
            Claude, ChatGPT or any client that speaks Streamable HTTP, and the same chart renders in the conversation.
          </p>
        </div>
        <CopyField value={`${SITE_URL}/api/mcp`} label="Guest endpoint (prices and plans, no saved runs)" />
        <p className={s.note}>
          For saved runs and savings, <Link href="/connect">make a household link</Link>. It is free and only needs a postcode or city.
        </p>
      </section>

      <section className={`shell ${s.section} ${s.faq}`}>
        <h2>Questions</h2>
        <dl>
          <div>
            <dt>Where does it work?</dt>
            <dd>
              Anywhere in Britain on Octopus Agile (by postcode, all 14 regions), northern Illinois on ComEd Hourly Pricing,
              and Germany on dynamic spot tariffs. On a flat tariff, ask for the greenest time instead: the carbon forecast
              still moves through the day.
            </dd>
          </div>
          <div>
            <dt>Does it switch my appliances on?</dt>
            <dd>
              Not yet. Today it plans and reminds. Most dishwashers and washing machines already have a delay-start
              button; Matter smart plugs and appliance APIs are next on the roadmap.
            </dd>
          </div>
          <div>
            <dt>What does it know about me?</dt>
            <dd>
              The postcode or city you give it and the runs you schedule. No account, no name, no meter data. A household
              is a random link; delete the link and the household is gone.
            </dd>
          </div>
          <div>
            <dt>Are these real prices?</dt>
            <dd>
              Yes. Every chart and number on this site is read from the published feeds within the last few minutes
              ({DEMO_PLACE} is a London postcode on the South Bank).
            </dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
