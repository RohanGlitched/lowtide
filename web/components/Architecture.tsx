import s from "./architecture.module.css";

/** How a question travels: the kitchen, the AWS stack in Sydney, and the public price feeds. */
const AWS: { name: string; does: string; detail: string; accent?: boolean }[] = [
  { name: "AWS Lambda", does: "Lowtide itself", detail: "The MCP server, the website and the Echo, in one Next.js function. Nine tools, OAuth 2.1 sign-in.", accent: true },
  { name: "Amazon CloudFront", does: "The front door", detail: "Serves the site fast everywhere, and is the only way in: nothing can reach Lowtide around it." },
  { name: "Amazon Bedrock", does: "Understands the question", detail: "Amazon Nova Micro picks a Lowtide tool for each thing you say on the Echo." },
  { name: "Amazon Polly", does: "Says the answer", detail: "Neural voices for each region's Echo, cached so a repeated answer costs nothing." },
  { name: "Amazon S3", does: "Remembers the household", detail: "Postcode, planned runs and savings; every write checked against the last one." },
  { name: "EventBridge Scheduler", does: "Plans tonight first", detail: "At 16:45 and 18:30 UK time, after tomorrow's prices, plans the night for every household." },
  { name: "Amazon CloudWatch", does: "Watches every call", detail: "One log line per tool call, turned into metrics, a dashboard and an alarm." },
];

const FEEDS = ["Octopus Energy Agile", "ComEd Hourly Pricing", "EPEX day-ahead (aWATTar)", "NESO carbon forecast"];

export default function Architecture() {
  return (
    <div className={s.arch}>
      <div className={s.side}>
        <h3>In the kitchen</h3>
        <p className={s.quote}>&ldquo;Alexa, when should I run the dishwasher? It needs to be done by seven.&rdquo;</p>
        <p className={s.note}>Alexa+ calls Lowtide over MCP. Claude, ChatGPT and VS Code call the same server.</p>
        <span className={s.arrow} aria-hidden />
      </div>
      <div className={s.cloud}>
        <div className={s.cloudHead}>
          <h3>On AWS</h3>
          <span>In Sydney. No passwords or access keys stored anywhere: each part signs in with its own AWS role.</span>
        </div>
        <ul className={s.tiles}>
          {AWS.map((a) => (
            <li key={a.name} className={a.accent ? s.accent : ""}>
              <strong>{a.name}</strong>
              <em>{a.does}</em>
              <p>{a.detail}</p>
            </li>
          ))}
        </ul>
      </div>
      <div className={s.side}>
        <span className={`${s.arrow} ${s.arrowIn}`} aria-hidden />
        <h3>Published feeds</h3>
        <ul className={s.feeds}>
          {FEEDS.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <p className={s.note}>Read live, every few minutes. No mocks, no stored prices.</p>
      </div>
    </div>
  );
}
