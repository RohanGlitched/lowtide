import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Mark } from "@/components/Header";
import { checkAuthorize, pickParams, AUTHORIZE_PARAMS } from "@/lib/oauth/authorize";
import { publicOrigin } from "@/lib/origin";
import s from "./authorize.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Connect an app", robots: { index: false, follow: false } };

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The consent form's answers when something needs fixing (codes, so the address can't put words on this page). */
const PROBLEMS: Record<string, string> = {
  place: "Enter a UK postcode, a northern Illinois town, or Germany.",
  tide: "Lowtide couldn't find prices for that place. Try a UK postcode, a northern Illinois town, or Germany.",
  limit: "That's a lot of new households from here. Try again in an hour, or use one you already have.",
  link: "Paste the household link Lowtide gave you. It ends in /api/mcp/h/ and ten letters and digits.",
  nohome: "That link doesn't match a household. Check it, or make a new one.",
};

function hostOf(uri: string): string {
  try {
    const u = new URL(uri);
    return u.protocol === "http:" || u.protocol === "https:" ? u.host : `${u.protocol}//`;
  } catch {
    return uri;
  }
}

/**
 * The consent page of Lowtide's authorization server: an MCP client (Claude, ChatGPT, an Alexa+ add-on's
 * account linking) sends the person here, and they pick the household it may plan for.
 */
export default async function Authorize({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const h = await headers();
  const origin = publicOrigin({ headers: h, url: `http://${h.get("host") ?? "localhost"}/` } as unknown as Request);
  const params = pickParams(sp);
  const checked = await checkAuthorize(params, origin);
  if (checked.kind === "error") redirect(checked.redirect);

  if (checked.kind === "fatal") {
    return (
      <main className={`shell ${s.main}`}>
        <p className={s.eyebrow}>Connect an app</p>
        <h1 className={s.title}>This app can&apos;t connect to Lowtide.</h1>
        <p className={s.lede}>{checked.message}</p>
        <p className={s.actions}>
          <Link href="/connect" className="btn btn-quiet">
            Other ways to add Lowtide
          </Link>
        </p>
      </main>
    );
  }

  const { client, redirectUri } = checked.request;
  const name = client.client_name;
  const back = hostOf(redirectUri);
  const problem = one(sp.lt_err);
  const err = problem && Object.hasOwn(PROBLEMS, problem) ? PROBLEMS[problem] : undefined;
  const pick = one(sp.lt_pick) === "existing" ? "existing" : "new";
  const place = one(sp.lt_place)?.slice(0, 40) ?? "";

  return (
    <main className={`shell ${s.main}`}>
      <div className={s.pair} aria-hidden="true">
        <span className={s.tile}>{name.trim().charAt(0).toUpperCase() || "?"}</span>
        <span className={s.link} />
        <span className={`${s.tile} ${s.mark}`}>
          <Mark size={34} />
        </span>
      </div>
      <p className={s.eyebrow}>Connect an app</p>
      <h1 className={s.title}>
        Let <span className={s.client}>{name}</span> plan your household&apos;s appliance runs?
      </h1>
      <p className={s.lede}>
        {name} is asking to use Lowtide for one household. Afterwards you go back to <strong>{back}</strong>.
      </p>

      <div className={s.grid}>
        <section className={s.scope} aria-label="What the app can do">
          <h2>It will be able to</h2>
          <ul className={s.can}>
            <li>Read the electricity prices and carbon forecast for the household&apos;s postcode or city</li>
            <li>Plan the cheapest time for the dishwasher, washing machine, car and the rest</li>
            <li>Save, list and cancel the household&apos;s planned runs, and read its savings and tonight&apos;s plan</li>
          </ul>
          <h2>It won&apos;t</h2>
          <ul className={s.cannot}>
            <li>Switch anything on. Lowtide only plans.</li>
            <li>See your name, email or anything outside Lowtide. Lowtide doesn&apos;t have them.</li>
          </ul>
          <p className={s.note}>
            {client.kind === "document" ? (
              <>This app is identified by its address, {hostOf(client.client_id)}.</>
            ) : (
              <>Lowtide hasn&apos;t verified this app. &ldquo;{name}&rdquo; is the name it gave when it registered.</>
            )}{" "}
            Only continue if you started this from {name}.
          </p>
        </section>

        <form className={s.panel} method="post" action="/api/oauth/authorize">
          {AUTHORIZE_PARAMS.map((k) => (params[k] !== undefined ? <input key={k} type="hidden" name={k} value={params[k]} /> : null))}
          <fieldset className={s.choices}>
            <legend>Which household?</legend>
            <div className={s.option}>
              <input type="radio" id="h-new" name="household" value="new" defaultChecked={pick === "new"} />
              <label htmlFor="h-new">
                <span className={s.optTitle}>A new household</span>
                <span className={s.optSub}>Lowtide finds your tariff from where you are. No account, no name.</span>
              </label>
              <div className={s.fields}>
                <label className={s.field}>
                  <span>Postcode or city</span>
                  <input name="place" defaultValue={place} placeholder="e.g. M1 1AE, Chicago, Germany" autoComplete="postal-code" minLength={2} maxLength={40} />
                </label>
                <label className={s.check}>
                  <input type="checkbox" name="demo" />
                  <span>Start with two weeks of sample runs priced at real rates (Britain only)</span>
                </label>
              </div>
            </div>
            <div className={s.option}>
              <input type="radio" id="h-existing" name="household" value="existing" defaultChecked={pick === "existing"} />
              <label htmlFor="h-existing">
                <span className={s.optTitle}>One I already have</span>
                <span className={s.optSub}>Paste the household link from the Connect page.</span>
              </label>
              <div className={s.fields}>
                <label className={s.field}>
                  <span>Household link</span>
                  <input name="link" placeholder={`${origin}/api/mcp/h/…`} autoComplete="off" spellCheck={false} maxLength={300} />
                </label>
              </div>
            </div>
          </fieldset>
          {err && (
            <p className={s.error} role="alert">
              {err}
            </p>
          )}
          <div className={s.buttons}>
            <button type="submit" name="decision" value="allow" className="btn btn-primary">
              Allow
            </button>
            <button type="submit" name="decision" value="deny" className="btn btn-quiet" formNoValidate>
              Don&apos;t allow
            </button>
          </div>
          <p className={s.fine}>
            {name} gets an hour at a time and renews it until you disconnect it there. Your household link keeps working either way.
          </p>
        </form>
      </div>
    </main>
  );
}
