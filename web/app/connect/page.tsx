import type { Metadata } from "next";
import CopyField from "@/components/CopyField";
import HouseholdLink from "@/components/HouseholdLink";
import { SITE_URL } from "@/lib/site";
import s from "./connect.module.css";

export const metadata: Metadata = {
  title: "Add to Claude or ChatGPT",
  description: "Connect the Lowtide MCP server to Claude, ChatGPT, VS Code or any Streamable HTTP client.",
};

export default function Connect() {
  return (
    <main className={`shell ${s.main}`}>
      <h1>Add Lowtide to your assistant</h1>
      <p className={s.lede}>
        Lowtide is a remote MCP server (Streamable HTTP, spec 2025-11-25 and 2026-07-28). Any client that supports remote
        MCP servers can use it, and clients that support MCP Apps draw the tide chart in the conversation.
      </p>

      <section className={s.block}>
        <h2>1. Make a household link</h2>
        <p>
          Your link carries your household: its postcode and its planned runs. No account and no name; keep the link
          private like a password.
        </p>
        <HouseholdLink />
      </section>

      <section className={s.block}>
        <h2>2. Add it to your client</h2>
        <dl className={s.clients}>
          <div>
            <dt>Claude</dt>
            <dd>
              Settings, Connectors, <em>Add custom connector</em>. Paste your link as the URL. Then ask: &ldquo;When should I
              run the dishwasher tonight?&rdquo;
            </dd>
          </div>
          <div>
            <dt>ChatGPT</dt>
            <dd>
              Settings, Apps &amp; Connectors, turn on developer mode, then <em>Create</em> and paste your link. Add Lowtide to
              a chat from the tools menu.
            </dd>
          </div>
          <div>
            <dt>VS Code</dt>
            <dd>
              Command palette, <em>MCP: Add Server</em>, choose HTTP and paste your link.
            </dd>
          </div>
          <div>
            <dt>Anything else</dt>
            <dd>
              Try it in the MCP Inspector: <code>npx @modelcontextprotocol/inspector</code>, transport Streamable HTTP, your
              link as the URL.
            </dd>
          </div>
        </dl>
      </section>

      <section className={s.block}>
        <h2>No household? Use the guest endpoint</h2>
        <p>
          Prices, plans and &ldquo;is now a good time&rdquo; work with a postcode or city in the question. Saving runs needs a
          household link.
        </p>
        <CopyField value={`${SITE_URL}/api/mcp`} label="Guest endpoint" />
      </section>

      <section className={s.block}>
        <h2>For agents: the Lowtide skill</h2>
        <p>
          The repository also ships an Agent Skill (<code>skills/lowtide/SKILL.md</code>) that teaches any skills-aware agent
          when to reach for these tools and how to phrase the answer for voice.
        </p>
      </section>
    </main>
  );
}
