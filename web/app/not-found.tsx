import Link from "next/link";
import type { Metadata } from "next";
import { Mark } from "@/components/Header";
import s from "./notfound.module.css";

export const metadata: Metadata = { title: "Not found" };

export const revalidate = 300;

export default function NotFound() {
  return (
    <main id="main" tabIndex={-1} className={`shell ${s.main}`}>
      <div className={s.copy}>
        <p className={s.code}>404</p>
        <h1 className="serif">Low tide: nothing at this address.</h1>
        <p className={s.lede}>
          The page you followed isn&apos;t here. The live things are the Echo simulator, today&apos;s prices in every region, and the MCP
          server you can add to your own assistant.
        </p>
        <div className={s.ctas}>
          <Link href="/echo" prefetch={false} className="btn btn-primary">
            Ask Alexa on the Echo
          </Link>
          <Link href="/tables" prefetch={false} className="btn btn-quiet">
            Today&apos;s tides
          </Link>
          <Link href="/" prefetch={false} className="btn btn-quiet">
            Home
          </Link>
        </div>
      </div>
      <div className={s.mark} aria-hidden>
        <Mark size={320} />
      </div>
    </main>
  );
}
