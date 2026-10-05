import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <main className="shell" style={{ paddingTop: 72, paddingBottom: 96, maxWidth: 720 }}>
      <h1 className="display" style={{ fontSize: "clamp(36px, 5vw, 56px)", margin: "0 0 16px" }}>
        Nothing at this address.
      </h1>
      <p style={{ fontSize: 18, lineHeight: 1.5, margin: "0 0 28px", color: "var(--steel)" }}>
        The page you followed isn&apos;t here. The live things are: the Echo simulator, today&apos;s prices by region, and the MCP
        server you can add to your own assistant.
      </p>
      <p style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Link href="/echo" className="btn btn-primary">
          Ask Alexa on the Echo
        </Link>
        <Link href="/tables" className="btn btn-quiet">
          Today&apos;s tides
        </Link>
        <Link href="/connect" className="btn btn-quiet">
          Add to Claude or ChatGPT
        </Link>
      </p>
    </main>
  );
}
