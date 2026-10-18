import type { Metadata } from "next";
import Clock from "@/components/Clock";
import CopyField from "@/components/CopyField";
import HouseholdLink from "@/components/HouseholdLink";
import { scenes } from "@/lib/live";
import { money } from "@/lib/format";
import { clock } from "@/lib/grid/time";
import { SITE_URL } from "@/lib/site";
import s from "./connect.module.css";

export const revalidate = 300;
export const metadata: Metadata = {
  title: "Add to Claude or ChatGPT",
  description: "Connect the Lowtide MCP server to Claude, ChatGPT, VS Code or any Streamable HTTP client.",
};

const CLIENTS: { name: string; how: React.ReactNode }[] = [
  {
    name: "Claude",
    how: (
      <>
        Settings, Connectors, <em>Add custom connector</em>. Paste your link as the URL, then ask: &ldquo;When should I run the
        dishwasher tonight?&rdquo;
      </>
    ),
  },
  {
    name: "ChatGPT",
    how: (
      <>
        Settings, Apps &amp; Connectors, turn on developer mode, then <em>Create</em> and paste your link. Add Lowtide to a chat from
        the tools menu.
      </>
    ),
  },
  {
    name: "VS Code",
    how: (
      <>
        Command palette, <em>MCP: Add Server</em>, choose HTTP and paste your link.
      </>
    ),
  },
  {
    name: "Anything else",
    how: (
      <>
        The MCP Inspector: <code>npx @modelcontextprotocol/inspector</code>, transport Streamable HTTP, your link as the URL.
      </>
    ),
  },
];

const ENDPOINTS: [string, string][] = [
  ["/api/mcp", "Guest: prices and plans for any postcode or city in the question. No account."],
  ["/api/mcp/h/<household>", "A household's private link: saved runs, tonight's plan, savings."],
  ["/api/mcp/account", "OAuth 2.1 sign-in: authorization code with PKCE, or client credentials for a service."],
  ["/.well-known/oauth-protected-resource", "Where an MCP client discovers the sign-in, per RFC 9728."],
  ["/.well-known/oauth-authorization-server", "The authorization server's metadata, per RFC 8414."],
];

export default async function Connect() {
  const places = await scenes().catch(() => []);
  const london = places[0]?.scene ?? null;
  const dish = london?.runs.find((r) => r.id === "dishwasher") ?? null;

  return (
    <main id="main" tabIndex={-1}>
      <section className={`shell ${s.main}`} aria-labelledby="connect-title">
        <div className="sectionHead">
          <h1 id="connect-title" className={`serif ${s.title}`}>
            Add Lowtide to your assistant.
          </h1>
          <p>
            Lowtide is a remote MCP server, so any assistant that can add one can use it. Assistants that support MCP Apps also
            show the day&apos;s prices on a dial, right in the conversation.
          </p>
        </div>
        <div className={s.quick}>
          <p>
            <strong>Just trying it?</strong> Paste the guest endpoint into your assistant. No account, no household; ask about any
            postcode.
          </p>
          <CopyField value={`${SITE_URL}/api/mcp`} label="Guest endpoint" />
        </div>

        <div className={s.grid}>
          <ol className={s.steps}>
            <li>
              <h2>Make a household link</h2>
              <p>
                The link carries your household: its postcode and its planned runs. No account and no name; keep it private like
                a password.
              </p>
              <HouseholdLink />
            </li>
            <li>
              <h2>Add it to your client</h2>
              <dl className={s.clients}>
                {CLIENTS.map((c) => (
                  <div key={c.name}>
                    <dt>{c.name}</dt>
                    <dd>{c.how}</dd>
                  </div>
                ))}
              </dl>
            </li>
          </ol>

          {london && dish && (
            <aside className={s.preview} aria-label="What you'll see in the conversation">
              <p className={s.previewLabel}>In the conversation</p>
              <div className={s.chat}>
                <p className={s.you}>When should I run the dishwasher tonight?</p>
                <p className={s.call}>
                  <span>plan_appliance</span> dishwasher, London
                </p>
                <div className={s.app}>
                  <div className={s.appDial}>
                    <Clock
                      data={{
                        slots: london.slots,
                        past: london.past,
                        now: london.now,
                        unit: london.unit,
                        timeZone: london.timeZone,
                        berths: [{ start: dish.start, end: dish.end, label: "dishwasher", state: "best" }],
                        centre: { time: dish.start, above: "start at", below: "dishwasher" },
                      }}
                      label="Lowtide's dial as an MCP App shows it, with the dishwasher's cheapest start marked"
                    />
                  </div>
                  <div className={s.appText}>
                    <strong>Run the dishwasher at {clock(dish.start, london.timeZone)}</strong>
                    <span>
                      {money(dish.cost, london)}
                      {dish.costTypical > dish.cost ? `, not ${money(dish.costTypical, london)} at a typical time` : ", as cheap as it gets"}
                    </span>
                  </div>
                </div>
                <p className={s.them}>
                  Run it at {clock(dish.start, london.timeZone)}: it costs about {money(dish.cost, london)}. Want me to save that for
                  your household?
                </p>
              </div>
              <p className={s.previewFine}>Drawn from London&apos;s live Octopus Agile prices; your assistant words the reply its own way.</p>
            </aside>
          )}
        </div>
      </section>

      <section className="shell section" aria-labelledby="other-title">
        <div className="sectionHead">
          <h2 id="other-title" className="serif">
            Other ways in.
          </h2>
          <p>No household needed to try it, a proper sign-in when your assistant supports one, and a skill for agents.</p>
        </div>
        <div className={s.ways}>
          <div>
            <h3>Guest endpoint</h3>
            <p>Prices, plans and &ldquo;is now a good time&rdquo; work with a postcode or city in the question. Saving runs needs a household.</p>
            <CopyField value={`${SITE_URL}/api/mcp`} label="Guest endpoint" />
          </div>
          <div id="account">
            <h3>Sign in with OAuth 2.1</h3>
            <p>
              Your assistant finds Lowtide&apos;s sign-in on its own, sends you to a Lowtide page to make or pick a household, and keeps a
              token that lasts an hour at a time. Disconnecting ends it.
            </p>
            <CopyField value={`${SITE_URL}/api/mcp/account`} label="Sign-in endpoint" />
          </div>
          <div>
            <h3>The Lowtide skill</h3>
            <p>An Agent Skill that teaches any skills-aware agent when to reach for these tools and how to phrase the answer for voice.</p>
            <a className="btn btn-quiet" href="https://github.com/RohanGlitched/lowtide/blob/main/skills/lowtide/SKILL.md" rel="noopener">
              Read SKILL.md
            </a>
          </div>
        </div>

        <div className={s.dev}>
          <h3>For developers</h3>
          <dl>
            {ENDPOINTS.map(([path, what]) => (
              <div key={path}>
                <dt>
                  <code>{path}</code>
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
          <p>
            Every endpoint speaks MCP over Streamable HTTP: the 2026-07-28 revision natively, and 2025-11-25, 2025-06-18 and
            2025-03-26 through <code>initialize</code>. Nine tools, one MCP App view.
          </p>
        </div>
      </section>
    </main>
  );
}
