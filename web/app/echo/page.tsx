import type { Metadata } from "next";
import Link from "next/link";
import Echo from "@/components/echo/Echo";
import s from "./page.module.css";

export const metadata: Metadata = {
  title: "Try it on Echo",
  description: "A simulated Alexa+ on an Echo Show, connected to the Lowtide MCP server. Ask when to run the dishwasher.",
};

const TURN: { title: string; body: string; detail: string }[] = [
  {
    title: "You speak",
    body: "Your browser's speech recognition turns your voice into text, or you type. Lowtide only ever sees the words.",
    detail: "Web Speech API",
  },
  {
    title: "Nova picks a tool",
    body: "Amazon Nova Micro on Bedrock reads what you said and calls one of Lowtide's nine tools with the arguments you gave, and only those.",
    detail: "1.0 to 1.3 s per model turn",
  },
  {
    title: "Lowtide answers",
    body: "The tool prices the live tariff for your household and returns a sentence to say and a screen to show: an MCP App, the same in Claude and ChatGPT.",
    detail: "MCP over Streamable HTTP",
  },
  {
    title: "Alexa says it",
    body: "Amazon Polly speaks the sentence in a neural voice for your region, and the run you said yes to is saved with the household.",
    detail: "Amazon Polly, Amazon S3",
  },
];

export default function EchoPage() {
  return (
    <main>
      <section className={s.kitchen} aria-labelledby="echo-title">
        <div className="shell">
          <div className={s.intro}>
            <h1 id="echo-title" className="serif">
              Ask Alexa when to run it.
            </h1>
            <p>
              A simulated Alexa+ on an Echo Show, connected to the live Lowtide MCP server. Talk or type the way you would in the
              kitchen. The screen is Lowtide&apos;s own MCP App view.
            </p>
          </div>
          <Echo />
        </div>
      </section>

      <section className="shell section" aria-labelledby="turn-title">
        <div className="sectionHead">
          <h2 id="turn-title" className="serif">
            What happens on each turn.
          </h2>
          <p>Four steps between your question and Alexa&apos;s answer, every one of them live. The conversation panel above shows each tool call as it happens.</p>
        </div>
        <ol className={s.turn}>
          {TURN.map((t) => (
            <li key={t.title}>
              <h3>{t.title}</h3>
              <p>{t.body}</p>
              <span>{t.detail}</span>
            </li>
          ))}
        </ol>
        <div className={s.note}>
          <div>
            <h3>Why a simulated Echo?</h3>
            <p>
              Alexa+ integrations are in preview for brands, so an outside developer can&apos;t yet put Lowtide on a real Echo. This page
              is a real MCP host instead: a real model, a real voice and the real server, on a screen the size of an Echo Show 8.
            </p>
          </div>
          <div className={s.noteCtas}>
            <Link href="/connect" prefetch={false} className="btn btn-primary">
              Add Lowtide to your assistant
            </Link>
            <Link href="/tables" prefetch={false} className="btn btn-quiet">
              See today&apos;s tides
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
