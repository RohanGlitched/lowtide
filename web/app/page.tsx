import Link from "next/link";
import Hero from "@/components/Hero";
import Clock from "@/components/Clock";
import EchoDevice from "@/components/EchoDevice";
import AppliancePicker from "@/components/AppliancePicker";
import CopyField from "@/components/CopyField";
import { scenes } from "@/lib/live";
import { getTide } from "@/lib/grid";
import { planRun } from "@/lib/plan";
import { planResult } from "@/lib/mcp/tools";
import { APPLIANCES } from "@/lib/appliances";
import { clock, dayPart, spokenTime } from "@/lib/grid/time";
import { money } from "@/lib/format";
import { SITE_URL } from "@/lib/site";
import s from "./home.module.css";

export const revalidate = 300;

const TOOLS: [string, string][] = [
  ["plan_appliance", "The cheapest or greenest start for an appliance, optionally done by a deadline."],
  ["schedule_run", "Saves the plan for the household once the person says yes."],
  ["check_now", "Whether this half hour is a cheap or dear time, and when it drops."],
  ["get_tide", "The next day of prices and grid carbon, with the cheapest and dearest hours."],
  ["list_runs", "What the household has planned."],
  ["cancel_run", "Cancels a planned run."],
  ["get_savings", "Money and CO₂ saved by running at the cheap hours."],
  ["set_home", "Sets the postcode or city, which picks the tariff."],
];

export default async function Home() {
  const places = await scenes();
  const london = places[0]?.scene ?? null;

  // What Alexa says right now in London, from the same tool Alexa calls.
  let answer: string | null = null;
  let remind: string | null = null;
  let plan: ReturnType<typeof planRun> | null = null;
  const tide = await getTide("SE1 7PB").catch(() => null);
  if (tide) {
    const now = Date.now();
    const dish = APPLIANCES[0];
    try {
      plan = planRun(tide.slots, { kwh: dish.kwh, minutes: dish.minutes, now, finishBy: london?.runs.find((r) => r.id === "dishwasher")?.end });
      answer = planResult(tide, dish, plan, now).content[0].text;
      const tz = tide.region.timeZone;
      remind = `Done. I'll remind you to run the dishwasher ${dayPart(plan.best.start, now, tz)} at ${spokenTime(plan.best.start, tz)}.`.replace(/\.\.$/, ".");
    } catch {}
  }
  const echoData =
    london && plan
      ? {
          slots: london.slots,
          now: london.now,
          unit: london.unit,
          timeZone: london.timeZone,
          berths: [{ start: plan.best.start, end: plan.best.end, label: "dishwasher", state: "best" as const }],
          centre: { time: plan.best.start, above: "start at", below: "dishwasher" },
        }
      : null;

  return (
    <main>
      {places.length > 0 ? (
        <Hero places={places} />
      ) : (
        <section className={`shell ${s.down}`}>
          <h1 className="display">Run it when power is cheapest.</h1>
          <p>The live price feeds didn&apos;t answer just now. Refresh in a minute.</p>
        </section>
      )}

      {answer && echoData && tide && plan && (
        <section className={`shell ${s.section} ${s.ask}`} aria-labelledby="ask-title">
          <div className={s.askDevice}>
            <EchoDevice>
              <div className={s.screen}>
                <div className={s.screenClock}>
                  <Clock data={echoData} theme="dark" label="Tonight's prices on the Echo Show with the dishwasher's start marked" />
                </div>
                <div className={s.screenText}>
                  <p className={s.screenHead}>Run the dishwasher at {clock(plan.best.start, tide.region.timeZone)}</p>
                  <p className={s.screenSub}>
                    {money(plan.best.cost, tide.region)}
                    {plan.now ? ` instead of ${money(plan.now.cost, tide.region)} now` : ""}
                  </p>
                </div>
              </div>
            </EchoDevice>
          </div>
          <div className={s.askText}>
            <h2 id="ask-title" className="display">
              Ask, and it answers twice.
            </h2>
            <p className={s.sub}>
              Out loud, in one sentence. And on the Echo Show&apos;s screen, as tonight&apos;s prices with the run marked on the rim.
            </p>
            <ol className={s.script}>
              <li data-who="you">Alexa, when should I run the dishwasher?</li>
              <li data-who="alexa">{answer}</li>
              <li data-who="you">Yes please.</li>
              <li data-who="alexa">{remind}</li>
            </ol>
            <p className={s.fine}>Produced minutes ago by the live tools, for London. Not a script.</p>
          </div>
        </section>
      )}

      {london && (
        <section className={`shell ${s.section}`} aria-labelledby="pick-title">
          <div className={s.head}>
            <h2 id="pick-title" className="display">
              Choose what to move.
            </h2>
            <p className={s.sub}>
              Every load costs a different amount each half hour. Pick one and the object re-cuts itself: cobalt marks when it
              should run.
            </p>
          </div>
          <AppliancePicker scene={london} />
        </section>
      )}

      <section className={`shell ${s.section}`} aria-labelledby="how-title">
        <div className={s.head}>
          <h2 id="how-title" className="display">
            From the kitchen to the grid in a second.
          </h2>
          <p className={s.sub}>
            Lowtide is an MCP server, the open standard Alexa+ uses to work with services. Four steps, every number read live.
          </p>
        </div>
        <ol className={s.steps}>
          <li>
            <h3>You ask</h3>
            <p>&ldquo;Alexa, when should I run the dishwasher? It needs to be done by seven.&rdquo;</p>
          </li>
          <li>
            <h3>Alexa+ calls Lowtide</h3>
            <p>
              <code>plan_appliance</code> with <code>finish_by: 07:00</code>, over Streamable HTTP.
            </p>
          </li>
          <li>
            <h3>Lowtide prices every start</h3>
            <p>From the half-hourly tariff and carbon forecast for your postcode, keeping only starts that finish in time.</p>
          </li>
          <li>
            <h3>The Echo answers</h3>
            <p>It says the time and the saving, and shows the day with the run marked (an MCP App).</p>
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

      <section className={`shell ${s.section}`} aria-labelledby="connect-title">
        <div className={s.head}>
          <h2 id="connect-title" className="display">
            Works in any assistant that speaks MCP.
          </h2>
          <p className={s.sub}>
            Alexa+ integrations are in preview for brands, so the Echo on this site is simulated. The server is real: add it to
            Claude, ChatGPT or VS Code and the same view renders in the conversation.
          </p>
        </div>
        <CopyField value={`${SITE_URL}/api/mcp`} label="Guest endpoint. Prices and plans; add a postcode or city to your question." />
        <p className={s.fine}>
          For saved runs and savings, <Link href="/connect">make a household link</Link>. Free, no account, just a postcode or city.
        </p>
      </section>

      <section className={`shell ${s.section}`} aria-labelledby="faq-title">
        <h2 id="faq-title" className={`display ${s.faqTitle}`}>
          Questions
        </h2>
        <div className={s.faq}>
          <details>
            <summary>Where does it work?</summary>
            <p>
              Britain on Octopus Agile (every postcode, all 14 regions), northern Illinois on ComEd Hourly Pricing, and Germany on
              dynamic spot tariffs. On a flat tariff, ask for the greenest time: the carbon forecast still moves through the night.
            </p>
          </details>
          <details>
            <summary>Does it switch the dishwasher on?</summary>
            <p>
              Not yet. It plans and reminds; most dishwashers and washing machines already have a delay-start button. Matter smart
              plugs and appliance APIs are next.
            </p>
          </details>
          <details>
            <summary>What does it know about me?</summary>
            <p>The postcode or city you give it and the runs you schedule. No account, no name, no meter data. A household is a random link.</p>
          </details>
          <details>
            <summary>Are these real prices?</summary>
            <p>Yes. Every number and every object on this site is cut from the published feeds within the last few minutes.</p>
          </details>
        </div>
      </section>
    </main>
  );
}
