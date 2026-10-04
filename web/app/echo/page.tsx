import type { Metadata } from "next";
import Echo from "@/components/echo/Echo";
import s from "./page.module.css";

export const metadata: Metadata = {
  title: "Try it on Echo",
  description: "A simulated Alexa+ on an Echo Show, connected to the Lowtide MCP server. Ask when to run the dishwasher.",
};

export default function EchoPage() {
  return (
    <main className={`shell ${s.main}`}>
      <div className={s.intro}>
        <h1>Ask Alexa when to run it</h1>
        <p>
          A simulated Alexa+ on an Echo Show, connected to the live Lowtide MCP server. Talk (or type) the way you would in
          the kitchen; the screen is Lowtide&apos;s own MCP App view, the same one Claude and ChatGPT render.
        </p>
      </div>
      <Echo />
    </main>
  );
}
