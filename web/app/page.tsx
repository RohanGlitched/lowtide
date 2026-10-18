import Link from "next/link";
import Hero from "@/components/Hero";
import Clock from "@/components/Clock";
import EchoDevice from "@/components/EchoDevice";
import TonightPlan from "@/components/TonightPlan";
import Architecture from "@/components/Architecture";
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
  ["get_tide", "The next day of prices and grid carbon, with the cheapest and dearest half hours."],
  ["get_tonight", "Tonight's plan, made ahead once tomorrow's prices are out."],
  ["list_runs", "What the household has planned."],
  ["cancel_run", "Cancels a planned run."],
  ["get_savings", "Money and CO₂ saved by running at the cheap hours."],
  ["set_home", "Sets the postcode or city, which picks the tariff."],
];

const MEASURED: { value: string; label: string; note: string }[] = [
  { value: "141", label: "tests, green in CI", note: "The planner against a day of real Agile, ComEd and EPEX prices, deadlines, both clock changes, OAuth, SigV4." },
  { value: "1.0–1.3 s", label: "per model turn", note: "Amazon Nova Micro on Bedrock, timed on the live AWS stack from India to Sydney." },
  { value: "16", label: "price regions", note: "All 14 British Agile regions, northern Illinois on ComEd and Germany on EPEX day-ahead." },
  { value: "0", label: "access keys", note: "Every AWS call is signed with the function's own role. The old keys were deleted." },
  { value: "33 of 33", label: "sign-in checks", note: "OAuth 2.1 end to end against production with the MCP SDK's own client." },
  { value: "14", label: "friction-log entries", note: "Every snag hit building on Alexa+, MCP and AWS, written down for the next builder." },
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
      remind =
        plan.now && plan.best.start === plan.now.start
          ? "Saved. Start the dishwasher now."
          : `Saved. Run the dishwasher ${dayPart(plan.best.start, now, tz)} at ${spokenTime(plan.best.start, tz)}.`.replace(/\.\.$/, ".");
    } catch {}
  }
  const echoData =
    london && plan
      ? {
          slots: london.slots,
          past: london.past,
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
        <section className="band" aria-labelledby="ask-title">
          <div className={`shell ${s.ask}`}>
            <div className={s.askDevice}>
              <EchoDevice dark>
                <div className={s.screen}>
                  <div className={s.screenClock}>
                    <Clock data={echoData} theme="dark" label="Tonight's prices on the Echo Show with the dishwasher's start marked" />
                  </div>
                  <div className={s.screenText}>
                    <p className={s.screenHead}>
                      {plan.now && plan.best.start === plan.now.start ? "Run the dishwasher now" : `Run the dishwasher at ${clock(plan.best.start, tide.region.timeZone)}`}
                    </p>
                    <p className={s.screenSub}>
                      {money(plan.best.cost, tide.region)}
                      {plan.now && plan.best.start !== plan.now.start
                        ? money(plan.now.cost, tide.region) !== money(plan.best.cost, tide.region) && plan.now.cost > plan.best.cost
                          ? ` instead of ${money(plan.now.cost, tide.region)} now`
                          : ", about the same as now"
                        : plan.now
                          ? ", as cheap as it gets today"
                          : ""}
                    </p>
                  </div>
                </div>
              </EchoDevice>
            </div>
            <div className={s.askText}>
              <h2 id="ask-title" className="display">
                Ask, and it answers twice.
              </h2>
              <p className={s.askSub}>
                Out loud, in one sentence. And on the Echo Show&apos;s screen, as the day&apos;s prices with the run marked on the rim.
              </p>
              <ol className={s.script}>
                <li data-who="you">Alexa, when should I run the dishwasher?</li>
                <li data-who="alexa">{answer}</li>
                <li data-who="you">Yes, save it.</li>
                <li data-who="alexa">{remind}</li>
              </ol>
              <p className={s.askFine}>Produced minutes ago by the live tools, for London. Not a script.</p>
              <Link href="/echo" prefetch={false} className={`btn btn-primary ${s.askCta}`}>
                Try it yourself on the Echo
              </Link>
            </div>
          </div>
        </section>
      )}

      {london && (
        <section className="shell section" aria-labelledby="tonight-title">
          <div className="sectionHead">
            <h2 id="tonight-title" className="display">
              Tonight, already planned.
            </h2>
            <p>
              Four everyday loads in a London home, each placed in the cheapest stretch that still finishes by morning. The nightly
              schedule does this for every household before anyone asks.
            </p>
          </div>
          <TonightPlan scene={london} place={places[0].label} />
        </section>
      )}

      <section className="band" aria-labelledby="how-title">
        <div className="shell">
          <div className="sectionHead">
            <h2 id="how-title" className="display">
              From the kitchen to the grid in seconds.
            </h2>
            <p>Lowtide is an MCP server, the open standard Alexa+ uses to work with services. Four steps, every number read live.</p>
          </div>
          <ol className={s.steps}>
            <li>
              <h3>You ask</h3>
              <p>&ldquo;Alexa, when should I run the dishwasher? It needs to be done by seven.&rdquo;</p>
            </li>
            <li>
              <h3>Alexa+ calls Lowtide</h3>
              <p>
                <code>plan_appliance</code> with <code>finish_by: &quot;seven&quot;</code>. No a.m. or p.m., so Lowtide takes the next seven the
                run can still make.
              </p>
            </li>
            <li>
              <h3>Lowtide prices every start</h3>
              <p>From the half-hourly tariff and carbon forecast for your postcode, keeping only starts that finish in time.</p>
            </li>
            <li>
              <h3>The Echo answers</h3>
              <p>It says the time, the deadline and the saving, and shows the day with the run marked: an MCP App.</p>
            </li>
          </ol>
          <div className={s.archWrap}>
            <Architecture />
          </div>
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
        </div>
      </section>

      <section className="shell section" aria-labelledby="measured-title">
        <div className="sectionHead">
          <h2 id="measured-title" className="display">
            Measured, not promised.
          </h2>
          <p>
            Every claim on this page is checked by a test, timed on the live stack, or read from a published feed. The code and the
            friction log are open.
          </p>
        </div>
        <ul className={s.measured}>
          {MEASURED.map((m) => (
            <li key={m.label}>
              <strong>{m.value}</strong>
              <span>{m.label}</span>
              <p>{m.note}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="shell section" aria-labelledby="connect-title">
        <div className="sectionHead">
          <h2 id="connect-title" className="display">
            Works in any assistant that speaks MCP.
          </h2>
          <p>
            Alexa+ integrations are in preview for brands, so the Echo on this site is simulated. The server is real: add it to Claude,
            ChatGPT or VS Code and the same dial renders in the conversation.
          </p>
        </div>
        <div className={s.ways}>
          <div>
            <h3>Just ask</h3>
            <p>Prices and plans with no account. Put the postcode or city in the question.</p>
            <CopyField value={`${SITE_URL}/api/mcp`} label="Guest endpoint" />
          </div>
          <div>
            <h3>Keep a household</h3>
            <p>Saved runs, tonight&apos;s plan and savings over weeks. A private link, no name, no account.</p>
            <Link href="/connect" prefetch={false} className="btn btn-quiet">
              Make a household link
            </Link>
          </div>
          <div>
            <h3>Sign in</h3>
            <p>The MCP specification&apos;s OAuth 2.1: your assistant finds Lowtide&apos;s sign-in page and keeps a token.</p>
            <CopyField value={`${SITE_URL}/api/mcp/account`} label="Sign-in endpoint" />
          </div>
        </div>
      </section>

      <section className="shell section" aria-labelledby="pays-title">
        <div className="sectionHead">
          <h2 id="pays-title" className="display">
            Who pays for it.
          </h2>
          <p>
            The household keeps the saving. The buyer is the energy supplier, which needs load moved out of the evening peak and
            already pays for it.
          </p>
        </div>
        <ul className={s.pays}>
          <li>
            <strong>2.46 million</strong>
            <p>British households and businesses signed up to NESO&apos;s Demand Flexibility Service by March 2026.</p>
          </li>
          <li>
            <strong>£943,983</strong>
            <p>paid to providers in winter 2024/25 for 3,917.7 MWh moved out of the peak, rewarded through their suppliers.</p>
          </li>
          <li>
            <strong>7 May 2027</strong>
            <p>when British suppliers must finish moving every meter to half-hourly settlement, so every home has a price per half hour.</p>
          </li>
          <li>
            <strong>1 Jan 2025</strong>
            <p>since when every German supplier must offer smart-meter customers a dynamic tariff.</p>
          </li>
        </ul>
        <p className={s.paysLine}>
          Alexa+ integrations are open to brands, so the route to market is a supplier-branded Lowtide: the supplier&apos;s tariff, the
          supplier&apos;s name on the Echo, and the evening peak a little lower.
        </p>
      </section>

      <section className="shell section" aria-labelledby="faq-title">
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
              Not yet. It plans the run and keeps it in the household&apos;s list; most dishwashers and washing machines already have a
              delay-start button. Matter smart plugs and appliance APIs are next.
            </p>
          </details>
          <details>
            <summary>What does it know about me?</summary>
            <p>The postcode or city you give it and the runs you schedule. No name and no meter data. A household is a private link, or a sign-in your assistant keeps.</p>
          </details>
          <details>
            <summary>Are these real prices?</summary>
            <p>Yes. Every number and every dial on this site is drawn from the published feeds within the last few minutes.</p>
          </details>
          <details>
            <summary>Why is part of the dial frosted?</summary>
            <p>
              Octopus publishes tomorrow&apos;s Agile prices at about 4 p.m. UK time. Until then the dial shows the rest of today, and
              earlier today&apos;s price for each half hour still to come, frosted, so the day reads whole without guessing.
            </p>
          </details>
          <details>
            <summary>Is this a real Alexa skill?</summary>
            <p>
              Alexa+ integrations are in preview for brands, so the Echo here is a simulation: a real MCP host with Amazon Nova Micro on
              Bedrock and Amazon Polly. The server it calls is the real one, the same any Alexa+ integration would call.
            </p>
          </details>
        </div>
      </section>
    </main>
  );
}
