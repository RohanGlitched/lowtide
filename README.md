<div align="center">

<img src="docs/cover.png" alt="Lowtide: ask Alexa when to run the dishwasher. Today's London electricity prices as a machined ring of 48 fins." width="100%">

# Lowtide

**Ask Alexa when to run the dishwasher. Lowtide answers from tonight's real electricity prices.**

An MCP server for Alexa+ that reads every half-hourly price and the grid's carbon forecast,<br>
and plans the dishwasher, the washing, the hot water and the car for the cheapest, cleanest time.

[![Live on AWS](https://img.shields.io/badge/live%20on%20AWS-d1soo7510nfzf4.cloudfront.net-2340ff)](https://d1soo7510nfzf4.cloudfront.net)
[![MCP](https://img.shields.io/badge/MCP-Streamable%20HTTP%20%C2%B7%20MCP%20Apps-16181b)](https://d1soo7510nfzf4.cloudfront.net/connect)
[![Amazon Bedrock](https://img.shields.io/badge/Amazon%20Bedrock-Amazon%20Nova%20Micro-16181b)](https://d1soo7510nfzf4.cloudfront.net/echo)
[![Amazon S3](https://img.shields.io/badge/Amazon%20S3-households-16181b)](#engineering-notes)
[![AWS Lambda](https://img.shields.io/badge/AWS-Lambda%20%C2%B7%20CloudFront%20%C2%B7%20Polly%20%C2%B7%20EventBridge%20Scheduler%20%C2%B7%20CloudWatch-16181b)](#runs-on-aws)
[![CI](https://github.com/RohanGlitched/lowtide/actions/workflows/ci.yml/badge.svg)](https://github.com/RohanGlitched/lowtide/actions/workflows/ci.yml)
[![MIT](https://img.shields.io/badge/license-MIT-5d636b)](LICENSE)

[**Try it on the Echo**](https://d1soo7510nfzf4.cloudfront.net/echo) · [**Watch the demo (2:54)**](https://youtu.be/LOHfsCr-m8Y) · [Add it to Claude or ChatGPT](https://d1soo7510nfzf4.cloudfront.net/connect) · [Today's prices, region by region](https://d1soo7510nfzf4.cloudfront.net/tables)

</div>

---

## The problem

Millions of homes now pay a different price for electricity every half hour: Octopus Agile in Britain, ComEd Hourly Pricing in Illinois, and dynamic tariffs in Germany, where every supplier has had to offer one to smart-meter customers since 1 January 2025 ([EnWG §41a](https://www.gesetze-im-internet.de/enwg_2005/__41a.html)). Britain is moving every meter to half-hourly settlement, and suppliers must finish by 7 May 2027 ([Ofgem, P487 decision](https://www.ofgem.gov.uk/sites/default/files/2026-05/decision-to-approve-BSC-P487-Incentive-on-BSC-Supplier-Parties-to-meet-the-M15-MHHS-Milestone.pdf)).

The money is in the big loads. On 15 October 2026 in London, charging a car (22 kWh) at Agile's cheapest time cost **£4.25 instead of £7.30** at a typical time of day, and heating a 6 kWh hot-water cylinder cost **£1.16 instead of £1.97**. Twice a week for the car and daily for the water, that is about **£610 a year from two habits** if every day were like that one. The baseline is a typical start (the average of every start time in the next 24 hours), not the evening peak; [`web/scripts/impact.ts`](web/scripts/impact.ts) prints today's figures for any postcode. The grid gains too: the car is 7.3 kW of load moved out of the evening, the immersion heater 3 kW.

But nobody reads a price table while plugging in the car or loading the dishwasher. The question is always the same, and it's asked out loud with your hands full: **"When should I run it?"** That's a voice question. Lowtide is the answer.

## What it does

<img src="docs/screens/echo-scheduled.png" alt="Simulated Echo Show: Alexa schedules the dishwasher for 01:00 and shows the day's prices on a dial" width="100%">

> **You:** Alexa, when should I run the dishwasher? It needs to be done by seven.
> **Alexa:** Run the dishwasher tonight at 1 a.m., done by 4 a.m., in time for 7 a.m. tomorrow morning. It costs about 23 pence, 7 pence less than starting now. Would you like to save it?
> **You:** Yes please.
> **Alexa:** Saved. Run the dishwasher tonight at 1 a.m. That saves 7 pence.

Asked on an evening in London (15 October 2026's prices): Amazon Nova Micro on Amazon Bedrock, calling Lowtide's MCP tools, with the live Agile rates. Every answer is priced from that day's published prices, so the hour and the pence change daily. "Seven" with no a.m. or p.m. means the next seven the run can still make: asked at 2 p.m., the same question plans for 7 p.m. today, and says so. Before about 4 p.m. UK time Octopus hasn't published tomorrow's prices, so an overnight deadline is planned from what is published and Alexa says tomorrow's prices aren't out yet. The answer comes back twice: **a sentence to speak**, and **an MCP App view for the Echo Show screen**, the next 24 hours on a dial with the run marked on the rim.

- **Plans any shiftable load** (dishwasher, washing machine, tumble dryer, EV, immersion heater, home battery), with a deadline ("done by seven"), an earliest start ("not before ten"), and a goal: cheapest, greenest, or both.
- **Remembers the household:** saved runs and money saved, behind a private household link (no account; a name is optional and never required).
- **Real prices everywhere:** Octopus Agile for every British postcode (all 14 regions), ComEd day-ahead hourly prices for northern Illinois, EPEX day-ahead for Germany, and the National Energy System Operator's regional carbon forecast.

## The day, machined

<img src="docs/object.gif" alt="The ring re-cuts itself for Glasgow, Chicago and Berlin" width="600">

The website turns each day into an object: a studio-lit ring of up to 48 aluminium fins (three.js), one per half hour, height = price. The cheapest quarter is anodised cobalt, the dearest graphite, and a polished pin stands at "now". Switch city and it re-cuts itself from that region's live prices. The Echo's screen shows the same object from above. Before Octopus publishes tomorrow's prices (about 4 p.m. UK time) a British ring only reaches 23:00 tonight, and the page says so rather than pretending it is a full day.

## Try it in one minute

1. Open **[d1soo7510nfzf4.cloudfront.net/echo](https://d1soo7510nfzf4.cloudfront.net/echo)**. A demo household in London is set up for you, with two weeks of past runs priced at the real rates of those nights.
2. Press **Talk to Alexa** (or type). Try: *"When should I run the dishwasher?"*, then *"Yes please"*, then *"How much have I saved?"* The engine line under the conversation says what is understanding you: Amazon Nova Micro on Amazon Bedrock, or Lowtide's own phrase router when Bedrock isn't reachable.
3. Watch the right-hand column: every MCP tool call Alexa makes is listed as it happens.
4. Want it in your own assistant? **[Make a household link](https://d1soo7510nfzf4.cloudfront.net/connect)** and add it to Claude (Settings → Connectors → Add custom connector) or ChatGPT (developer mode → Create).
5. Or open it in **[Countertop](https://d124pgg01fg3le.cloudfront.net/?server=https://d1soo7510nfzf4.cloudfront.net/api/mcp)**, the open-source voice and screen test bench for MCP servers that came out of this project ([source](https://github.com/RohanGlitched/countertop)).

## Screens

| | |
|---|---|
| <img src="docs/screens/home-hero.png" alt="Home: live headline and the 3D object"> | <img src="docs/screens/home-glasgow.png" alt="The same object re-cut for Glasgow"> |
| **Home.** The headline is live data; the ring is the next 24 hours in London. | **Glasgow.** Every region gets a different object every day. |
| <img src="docs/screens/home-pick-car.png" alt="Choose what to move: the car's cheapest window cut in cobalt"> | <img src="docs/screens/home-ask.png" alt="Echo Show mock with the dishwasher plan"> |
| **Choose what to move.** Pick a load; cobalt marks when it should run, with the saving. | **Ask, and it answers twice.** The live answer for London, spoken and drawn. |
| <img src="docs/screens/echo-plan.png" alt="Echo simulator mid-conversation"> | <img src="docs/screens/tables.png" alt="Today's prices for 16 regions as dials"> |
| **Echo simulator.** Bedrock picks the tool; the MCP App view renders on the screen. | **Today, region by region.** 14 Agile regions, Illinois and Germany. |

<p align="center">
  <img src="docs/screens/phone-home.png" alt="Phone: home" width="250">
  <img src="docs/screens/phone-object.png" alt="Phone: the object" width="250">
  <img src="docs/screens/phone-echo.png" alt="Phone: Echo simulator" width="250">
</p>

## How it works

```mermaid
sequenceDiagram
    autonumber
    actor You
    participant Echo as Echo Show (Alexa+)
    participant Model as Amazon Nova Micro<br/>on Amazon Bedrock
    participant MCP as Lowtide MCP server
    participant Feeds as Octopus · NESO · ComEd · EPEX
    You->>Echo: "When should I run the dishwasher? Done by seven."
    Echo->>Model: utterance + Lowtide's tool list
    Model-->>Echo: call plan_appliance(dishwasher, finish_by "seven")
    Echo->>MCP: tools/call over Streamable HTTP
    MCP->>Feeds: half-hourly prices + carbon forecast
    MCP-->>Echo: sentence + structured result + ui:// view
    Echo->>Model: tool result
    Model-->>Echo: "Run it at one in the morning…"
    Echo-->>You: speaks, and draws the dial with the run on its rim
```

```mermaid
flowchart TB
    subgraph Hosts["Any MCP host"]
        ECHO["Echo simulator<br/>(MCP client + MCP Apps host in the browser)"]
        CLAUDE["Claude · ChatGPT · VS Code"]
    end
    ECHO -- "model turns" --> ALEXA["/api/alexa<br/>Bedrock Converse (Nova Micro)<br/>or the built-in phrase router"]
    ECHO -- "Streamable HTTP" --> MCP
    CLAUDE -- "Streamable HTTP" --> MCP
    MCP["Lowtide MCP server<br/>9 tools + 1 ui:// view<br/>(mcp-handler, MCP SDK v2)"] --> PLAN["Planner<br/>every start that fits, priced per half hour"]
    PLAN --> FEEDS["Price and carbon feeds<br/>Octopus Agile · NESO · ComEd · aWATTar"]
    MCP --> STORE[("Households<br/>private Amazon S3 bucket, If-Match on the ETag")]
```

### The tools

| Tool | What it does | Shows a view |
|---|---|---|
| `plan_appliance` | Cheapest or greenest start for a load, with an optional deadline and earliest start; compares with starting now and says the deadline back. "Seven" with no a.m. or p.m. is the next seven the run can still make (this evening when asked at 2 p.m., tomorrow morning when asked at 6:30 p.m.); a time the person pinned down ("7am", "19:00", "in ten minutes") is never moved, and one the run can't make gets "it can't be done by then; starting now it finishes at…" | ✓ |
| `schedule_run` | Saves the run once the person agrees, with its saving (it keeps the plan; it doesn't switch anything on). On hosts that can show a form (MCP elicitation, 2026-07-28) the person confirms on screen; elsewhere the spoken "yes" counts | ✓ |
| `check_now` | Whether this half hour is cheap or dear, and when it drops; name an appliance and it prices that load now against its best later start | ✓ |
| `get_tide` | The next 24 hours of prices and carbon, with the cheapest and dearest half hours ("now" when it's the one under way, so "cheapest" is never dearer than the price now); `after: "18:00"` answers "tonight" | ✓ |
| `list_runs` / `cancel_run` | The household's planned runs | ✓ |
| `get_savings` | Money and CO₂ saved by running at the cheap hours | ✓ |
| `set_home` | Postcode or city, which picks the tariff region | |
| `get_tonight` | Tonight's plan, made once a night as soon as tomorrow's prices are published: the best start for each appliance the household uses, and whether tonight is unusually cheap. Also a resource, `lowtide://household/tonight` | ✓ |

Every tool returns a **voice-ready sentence** first (times said the way people say them, money in pence or cents), a **structured result** for the view, and, for `plan_appliance`, a line the model uses for `schedule_run` but never reads aloud. The server ships its own instructions, and the repo ships an **Agent Skill** ([`skills/lowtide/SKILL.md`](skills/lowtide/SKILL.md)) for skills-aware agents.

### Built for a voice device

- **The answer leads.** "Run the dishwasher at 01:00" is the headline on screen and the first words spoken.
- **Readable across a kitchen.** The view has a fullscreen layout for device screens (sized from the screen, nothing scrolls) and an inline one for chat hosts.
- **Never stuck.** If Bedrock is unavailable or the daily budget is spent, the simulator falls back to a deterministic phrase router that calls the same tools, and the tools' own sentences are spoken. The page says which one is answering, from a real probe, not from whether a key is set.
- **A real voice.** Replies are spoken by Amazon Polly's neural voices, chosen by tariff region: Amy (British English) for Agile, Joanna (American English) for ComEd, Vicki (German) for EPEX. Plain text only, no SSML, so nothing in a tool result can change how it is said; capped per visitor and per day in characters, cached by a hash of the sentence. If Polly is unreachable the browser's own speech takes over, and the page labels whichever voice actually spoke.
- **Proactive, on a schedule.** An Echo shows a waiting notification as a yellow light. Lowtide's version: Octopus publishes tomorrow's prices at about 4 p.m. UK time, and Amazon EventBridge Scheduler runs tonight's plan at 16:45 and again at 18:30 London time, planning the coming night for every saved household, once, and storing it with the household (If-Match, like every write); the Echo pulses yellow and shows "Tonight is unusually cheap: tumble dryer at 02:00" until you hear it. The 18:30 run catches a late publication or households the first run had no time for. If a schedule is ever missed, the lazy roll still covers it: the first request after the prices are out plans that household, and each request takes one short, bounded step through the others.
- **A chain of models.** The server asks for Amazon Nova Micro first, the cheapest Bedrock model with tool use, through the Asia Pacific inference profile in Sydney; if the account can't call it (model access, an organisation policy, a region rule), it tries Nova Lite and remembers what worked. Nova's `<thinking>` text is stripped, so Alexa never reads it aloud.
- **Signed requests, no SDK.** Bedrock, S3 and Polly are all called with SigV4-signed requests from one small signer in `node:crypto` ([`web/lib/aws/sigv4.ts`](web/lib/aws/sigv4.ts), checked in tests against botocore's signatures). On AWS the credentials are the Lambda function's own role (temporary, with a session token, nothing stored anywhere); its policy allows `InvokeModel` on Nova Micro and Nova Lite, get, put and list on the households bucket, and `SynthesizeSpeech`. No access key exists for Lowtide or Countertop anywhere: the first deployment, on Vercel, used two single-purpose IAM users (the organisation denies the OIDC provider that keyless access from Vercel would need); that copy now only redirects every path to AWS, and both users' access keys were deleted on 18 October 2026.
- **Bounded cost.** The model route answers only its own pages, checks every message shape, and caps calls at 40 per visitor per 10 minutes and 250 per visitor per day (per server instance), plus 1,500 a day in all (a count shared through the S3 store, synced every 20 calls and on every call once 80% is spent). The same-origin check stops casual reuse but is not authentication, so the caps are the real guard.

## Runs on AWS

Lowtide runs on AWS at **[d1soo7510nfzf4.cloudfront.net](https://d1soo7510nfzf4.cloudfront.net)** (MCP endpoint: `https://d1soo7510nfzf4.cloudfront.net/api/mcp`). Everything except the households bucket is one CloudFormation stack in Sydney (ap-southeast-2), deployed by [`infra/deploy.py`](infra/deploy.py) from [`infra/template.yaml`](infra/template.yaml). The households bucket (`lowtide-homes-0415`, private, same region) is older than the stack and is passed to it as a parameter, so deleting the stack leaves households alone; it, and the bucket `deploy.py` uploads code to, are deleted separately. No servers, no containers, no access keys (the function signs every AWS call with its own role), sized for the free tier.

```mermaid
flowchart LR
    V(["Echo simulator · Claude · ChatGPT · any MCP host"]) --> CF["Amazon CloudFront<br/>one address, HTTP/2 and 3"]
    CF -- "/_next/static/*" --> S3S[("Amazon S3<br/>hashed assets, origin access control")]
    CF -- "pages, /api/mcp (streamed), /api/*<br/>+ secret origin header" --> URL["Lambda Function URL<br/>RESPONSE_STREAM<br/>(refuses requests without the header)"]
    URL --> L["AWS Lambda · Node.js 22 · arm64<br/>Next.js standalone + Lowtide MCP server<br/>(Lambda Web Adapter)"]
    L -- "Converse, SigV4 with the function's role" --> BR["Amazon Bedrock<br/>Amazon Nova Micro → Nova Lite"]
    L -- "SynthesizeSpeech" --> PO["Amazon Polly<br/>neural Amy · Joanna · Vicki"]
    L -- "If-Match writes" --> S3H[("Amazon S3<br/>households, tonight's plans,<br/>daily budgets, speech cache")]
    L -- "one JSON line per tool call" --> CW["Amazon CloudWatch<br/>logs (14 days), metric filters,<br/>error alarm, dashboard"]
    EB["Amazon EventBridge Scheduler<br/>16:45 and 18:30 London time,<br/>keep-warm every 5 minutes"] -- "invoke, with the deploy's token<br/>(Web Adapter → POST /events)" --> L
    IAM["IAM roles<br/>least privilege, no keys"] -.-> L
```

| AWS service | What it does for Lowtide | Why this one |
|---|---|---|
| **AWS Lambda** (Node.js 22, arm64) | Runs the whole Next.js app: the website, the MCP server (Streamable HTTP), the model, voice and household routes. Reserved concurrency 25, room for several judges at once (one Echo page load is about five requests) and a ceiling on spend | Pay per request and free at demo scale; arm64 is cheaper per millisecond; nothing to patch |
| **Lambda Function URL** in response-streaming mode, with the **Lambda Web Adapter** | Turns HTTPS requests into requests to the Next.js server and streams the answers back, so MCP's server-sent events arrive as they are written. The URL answers only requests that carry CloudFront's secret origin header (a NoEcho stack parameter `deploy.py` generates once and keeps); anything else gets a 403, so it can't be used to go around CloudFront | No API Gateway needed, and streaming is what MCP's Streamable HTTP expects |
| **Amazon CloudFront** | The one public address: caches `/_next/static` for a year and pages only as long as Next.js says, never caches `/api/*`, hands the function the visitor's host | TLS, HTTP/3 and edge caching in front of a function that may be cold |
| **Amazon S3** | Static assets (through origin access control, the bucket stays private) and, in a second bucket, every household as one JSON object with `If-Match` on the ETag | Conditional writes give safe read-modify-write without a database; a few cents a month |
| **Amazon Bedrock** (Converse API, Amazon Nova Micro, APAC inference profile) | Every turn of the Echo simulator: picks the Lowtide tool, then words the answer | The cheapest Bedrock model with tool use, answering in about a second from Sydney |
| **Amazon Polly** (neural voices) | Speaks every Echo reply and tonight's notification in the household's region's voice | Natural speech that is the same on every browser, which Web Speech is not |
| **Amazon EventBridge Scheduler** | Two schedules, `lowtide-web-tonight-1645` and `lowtide-web-tonight-1830` (cron in `Europe/London`, flexible window off, 2 retries), invoke the function after Octopus publishes tomorrow's prices; the Lambda Web Adapter hands the event to `POST /events`, which plans tonight for every household within a time budget and logs one summary line. A third, `lowtide-web-warm` (every 5 minutes, about 8,600 invocations a month), keeps one instance warm and its price feeds fresh, so the first visitor after a quiet spell doesn't wait for a cold start | Tonight's plan is ready before anyone asks, on London's clock through both clock changes, with no server or rule to run; the lazy roll on ordinary requests stays as the fallback |
| **Amazon CloudWatch** | One JSON log line per tool call, model turn, Polly request, nightly roll and scheduled run; ten metric filters turn them into tool calls, errors, Bedrock latency, Polly characters, tonight's plans and scheduled runs, failures and households planned on a dashboard; an alarm on Lambda errors | Seeing what judges and users actually do, at no cost |
| **AWS IAM** | Two roles: the execution role (`bedrock:InvokeModel` on Nova Micro and Lite only, the households bucket only, `polly:SynthesizeSpeech`) and `lowtide-web-scheduler`, which EventBridge Scheduler assumes and which may only invoke this one function | No access keys exist for Lowtide at all |
| **AWS CloudFormation** | The stack (29 resources, the three schedules and their role included; 28 deployed without an alarm email) from one template; `deploy.py` packages, uploads, deploys and invalidates in one command, with `--dry-run` to build and validate offline | Repeatable; deleting it after judging takes one step, plus the two buckets kept outside it (households and deploy artifacts) |

Countertop, the open-source test bench, has its own small stack on the same pattern ([`countertop/infra`](https://github.com/RohanGlitched/countertop/tree/main/infra)): the static site in S3 behind CloudFront, and its model function on Lambda under `/api/turn`, with a role that may only call Nova Micro and Nova Lite.

Deploying it yourself (any account; Python 3.12 with boto3, Node.js 22; credentials from the usual AWS environment):

```bash
python infra/deploy.py --dry-run     # build, package and validate the template; no AWS calls
python infra/deploy.py               # create or update the stack, upload assets, invalidate, smoke-test
```

## Engineering notes

- **MCP:** `mcp-handler` 2 with MCP SDK v2, stateless Streamable HTTP, one route for every protocol revision. 2026-07-28 is served natively: `server/discover` lists it, and requests carry the per-request `_meta` envelope and `Mcp-Method` header, with no `initialize` (that revision removed it). The 2025 revisions use `initialize`: 2025-11-25, 2025-06-18 and 2025-03-26 (the version Amazon's Alexa+ client sample sends). An `initialize` that asks for 2026-07-28 is answered with 2025-11-25, the newest revision that has `initialize`; [`web/test/protocol.test.ts`](web/test/protocol.test.ts) checks all three paths against the real handler. One endpoint per household (`/api/mcp/h/<id>`), a guest endpoint for questions that name a place, and `/api/mcp/account` for clients that sign in with OAuth. `mcp-handler` sends no CORS headers, so browser hosts like Countertop need `withCors()` in [`web/lib/mcp/handler.ts`](web/lib/mcp/handler.ts); the general fix is an open pull request upstream, [vercel-labs/mcp-handler#200](https://github.com/vercel-labs/mcp-handler/pull/200) (an opt-in `cors` option, 11 tests; not merged).
- **MCP Apps:** the `ui://lowtide/tide-chart.html` resource is one self-contained HTML file (esbuild), using `@modelcontextprotocol/ext-apps`. The Echo simulator hosts it in an opaque-origin sandboxed iframe through `AppBridge`, the same protocol Claude and ChatGPT use.
- **Prices:** Agile rates by region letter (postcode → grid supply point), NESO regional carbon by region id, ComEd's day-ahead feed parsed from Chicago wall-clock time, aWATTar EUR/MWh → ct/kWh. Feeds are cached two minutes and fail one at a time.
- **Planner:** every half-hour start that finishes in time is priced by spreading the load evenly over the slots it covers (partial slots included); "balanced" normalises cost and carbon distance from each optimum. Negative prices count as a credit.
- **Storage:** one JSON object per household in a private Amazon S3 bucket in Sydney, the same region as Bedrock, with all public access blocked. Every update is a read-modify-write guarded by S3's `If-Match` on the object's ETag, so two quick saves from two devices can't silently overwrite each other; a conflict re-reads and retries with backoff, and one that still conflicts says "try again" rather than overwriting. The store sits behind a small interface (`web/lib/storage.ts`) with Google Cloud Storage and Vercel Blob as alternatives; Lowtide started on Blob and moved to S3 when the Hobby account's shared monthly Blob allowance ran out during the submission period and took every household with it. On S3 the whole thing costs cents: small JSON objects and a few thousand requests a month.
- **Households are capability links, and also OAuth grants.** A household is `/api/mcp/h/<id>`, ten random base-32 characters (about 50 bits), and holds only a place and its planned runs: no name required, no address, no payment details. A link works in every MCP host today, so it stays. Next to it, the same server is an OAuth 2.1 protected resource with its own authorization server ([Sign in with OAuth](#sign-in-with-oauth-alexa-account-linking)): a client signs in at `/api/mcp/account`, the person picks or makes a household on a consent page, and the token is bound to that household. In production the energy supplier would be the identity provider, so a household signs in once with the account it already has.
- **Savings are quoted against a typical start.** Every saving on the website compares the cheapest start with the average of every start time in the next 24 hours (`typicalCost` in `web/lib/plan.ts`), not with the evening peak, and the page says so. The voice tools compare with starting now, and say that too.
- **Tonight's plan on a schedule:** EventBridge Scheduler targets the Lambda function directly with a fixed JSON Input; the Lambda Web Adapter passes any non-HTTP event to `POST /events` (`AWS_LWA_PASS_THROUGH_PATH`). That route accepts only an event carrying a random token that `deploy.py` generates on every deploy and that lives in just two places, the function's environment (`SCHEDULE_TOKEN`) and the schedules' Input, compared in constant time. A header check can't do this job: Next.js adds `x-forwarded-*` headers to every request it serves, the adapter's loopback call included, so the first version refused the real scheduled call (friction log 14). CloudFront returns 404 for `/events`, and the Function URL refuses every request without CloudFront's origin secret except `/events` itself, which the adapter calls on loopback and which still needs the token. Verified on 15 October 2026: invoked with the schedule's own Input, the function answered `{"ok":true,"night":null,…}` (at 13:03 BST tomorrow's prices weren't out yet, so the job waits for the next run) and CloudWatch logged `{"evt":"schedule","job":"tonight","ok":true,…}`. Every step is idempotent and guarded by If-Match, so the two runs, a retry and a visitor's lazy step never plan a household twice.
- **Performance:** the 3D object renders on demand (static shadow map, 30 fps idle turn, paused off screen), compiles shaders asynchronously, and mounts in idle time.

## Sign in with OAuth (Alexa+ account linking)

Amazon's Alexa+ MCP Toolkit guidance asks an add-on server for OAuth: a service tier (`client_credentials`, scope `mcp:service`) and a user tier (`authorization_code` with PKCE). The MCP specification (2025-11-25 and 2026-07-28) asks for the same in its own words: Protected Resource Metadata, an authorization server with metadata, PKCE with S256, resource indicators and a `WWW-Authenticate` challenge. Lowtide does both, on the same Lambda function, with no new service and no key. It has been run end to end with the MCP TypeScript SDK's OAuth client, locally and in production (33 checks, [`web/scripts/oauth-e2e.mjs`](web/scripts/oauth-e2e.mjs)); it has not yet been tested with a real Alexa+ client.

```mermaid
sequenceDiagram
    autonumber
    participant C as MCP client (Claude, ChatGPT, the SDK, an Alexa+ add-on)
    participant R as Lowtide MCP server<br/>/api/mcp/account
    participant A as Lowtide authorization server
    actor P as Person
    C->>R: initialize (no token)
    R-->>C: 401, WWW-Authenticate: Bearer resource_metadata=…
    C->>R: GET /.well-known/oauth-protected-resource/api/mcp/account
    C->>A: GET /.well-known/oauth-authorization-server
    C->>A: POST /api/oauth/register (or a client ID metadata document)
    C->>P: open /oauth/authorize (code_challenge S256, resource)
    P->>A: "Let Claude plan your household's appliance runs?" New household or a pasted link, then Allow
    A-->>C: redirect with code, state and iss
    C->>A: POST /api/oauth/token (code + code_verifier)
    A-->>C: access token (1 hour, bound to the household) + rotating refresh token
    C->>R: tools/call plan_appliance, Authorization: Bearer …
```

| Endpoint | What it is |
|---|---|
| `/api/mcp/account` | The MCP server behind OAuth: no token gets `401` with `resource_metadata` and `scope="mcp:tools mcp:resources"` |
| `/api/mcp` | Unchanged: no token is the guest server; a bearer token, if sent, is checked and used. `MCP_AUTH=required` (stack parameter `McpAuth`) makes it answer 401 too |
| `/api/mcp/h/<id>` | Unchanged: the household's capability link, no OAuth |
| `/.well-known/oauth-protected-resource[/api/mcp[/account]]` | RFC 9728 Protected Resource Metadata |
| `/.well-known/oauth-authorization-server` | RFC 8414 metadata: S256 only, `client_id_metadata_document_supported`, `authorization_response_iss_parameter_supported` (RFC 9207) |
| `/oauth/authorize` | The consent page: make a household from a postcode or paste an existing household link, then Allow or Don't allow |
| `/api/oauth/token` | `authorization_code` (PKCE S256), `refresh_token` (rotating, with replay detection), `client_credentials` |
| `/api/oauth/register` | RFC 7591 dynamic registration, open; public or confidential clients |
| `/api/oauth/revoke` | RFC 7009 revocation: a refresh token ends the grant and its access tokens |

**Scopes.** `mcp:service` (client_credentials only): initialize, tools/list and the guest tools; never a household, never a refresh token. `mcp:tools` and `mcp:resources` (authorization_code only): the household's tools and its `lowtide://household/tonight` resource. A service token that calls a household tool gets `403` with `error="insufficient_scope"`.

**Design choices.**
- **Opaque tokens, no signing key.** Every token, code and client secret is 256 random bits, and the households bucket stores only its SHA-256 (under `oauth/`). So there is no JWT key to keep in a stack parameter, an environment variable or the bucket, and revocation takes effect on the next request. The cost is one S3 read per MCP request that carries a token, a few milliseconds in-region.
- **Single use by If-Match.** A code is spent and a refresh token rotated with S3's `If-Match` on the ETag, the same conditional write the households use, so two racing exchanges get one token set. A replayed code or a rotated-out refresh token revokes the whole grant.
- **No sessions or cookies.** The consent form carries the original request and is checked again on submit. A household is chosen by making it there or by pasting its private link, so a forged form has nothing to ride on. The page can't be framed, and its error messages are codes, not text from the address.
- **Behind a Lambda Function URL the challenge header is renamed.** Function URLs pass a response's `WWW-Authenticate` on as `x-amzn-Remapped-WWW-Authenticate`, and CloudFront runs no viewer-response function on a 4xx, so on AWS the 401 and 403 challenges (with `resource_metadata` and `error`) arrive under that name. Clients that don't see the header fall back to the well-known metadata, as the MCP spec allows, and Lowtide serves it at both the root and the path-inserted address, so the MCP SDK's client discovers, registers and signs in unchanged (checked in production on 18 October 2026). A 403 for a service token is still a 403; a client that wants the scope it names reads the renamed header.
- **Nothing piles up.** Codes live five minutes and access tokens an hour; an S3 lifecycle rule on the households bucket (kept outside the stack, like the bucket) deletes `oauth/codes/` and `oauth/access/` records two days after they are written.
- **Client ID metadata documents.** A client may use the HTTPS URL of its metadata document as its `client_id`, the MCP spec's preferred registration from 2025-11-25 (dynamic registration is deprecated in 2026-07-28 but still served). Lowtide fetches the document only from public addresses, without redirects, within 5 seconds and 64 KB.

### Alexa+ add-on authentication: conformance

| Alexa+ MCP Toolkit guidance | Lowtide |
|---|---|
| Tier 1 `client_credentials`, scope `mcp:service`, no user data | ✓ `mcp:service` only; service tokens carry no household and are refused household tools (403) |
| Tier 2 `authorization_code` + PKCE, user scopes `mcp:tools`, `mcp:resources` | ✓ S256 only (`plain` refused), bound to the household the person picks |
| `expires_in` ≤ 3600 s | ✓ 3600 |
| No `refresh_token` for client credentials | ✓ none issued |
| `resource` required and checked against the MCP server URI | ✓ required for client_credentials and checked on every grant (`invalid_target` otherwise); defaults to `/api/mcp` at authorize |
| Client authentication by HTTP Basic (or the body), never in the query | ✓ `client_secret_basic` and `client_secret_post`; query credentials are ignored |
| Metadata with issuer, endpoints, `response_types_supported: ["code"]`, grants, `code_challenge_methods_supported: ["S256"]`, scopes | ✓ `/.well-known/oauth-authorization-server` |
| Errors in RFC 6749 §5.2 form: `invalid_client` 401, `invalid_scope` and `invalid_request` 400, `access_denied` 403 | ✓ same codes and statuses (`invalid_client` 401 with a Basic challenge), `Cache-Control: no-store`; `access_denied` goes back on the redirect when the person says no |
| Pre-registered client (Alexa+ doesn't use dynamic registration) | ✓ register once with the call below and enter the id and secret in the Alexa developer console |
| Alexa+ doesn't need `WWW-Authenticate` on 401 | Sent anyway: the MCP spec needs it for Claude, ChatGPT and SDK clients, and a client that doesn't use it ignores it |

Registering the Alexa+ service client (the secret is shown once and stored only as a hash):

```bash
curl -s https://d1soo7510nfzf4.cloudfront.net/api/oauth/register -H 'content-type: application/json' \
  -d '{"client_name":"Alexa+","grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic"}'
```

## Proof

| Claim | Where it's checked |
|---|---|
| The planner picks the cheapest and greenest windows, respects deadlines, handles partial slots and negative prices | [`web/test/plan.test.ts`](web/test/plan.test.ts) |
| Asked for the cheapest time, it never recommends a start dearer than starting now; a greener pick that costs more says so out loud ("about 5 pence more than starting now, but 5% less carbon"), for every appliance and goal across a day of real Agile, ComEd and EPEX prices | [`web/test/now.test.ts`](web/test/now.test.ts) |
| Times survive DST and time zones (the London and Chicago clock changes, ComEd's repeated hour); "7am", "7:30 p.m.", "noon" and ISO all parse | [`web/test/time.test.ts`](web/test/time.test.ts), [`web/test/edges.test.ts`](web/test/edges.test.ts) |
| "Done by seven" is the next seven the run can still make (7 p.m. at 13:48, 7 a.m. at 18:30) and is said back; "7am", "19:00" and "in ten minutes" are never moved, and one the run can't make answers "it can't be done by then" with the earliest finish; a deadline past the published prices says tomorrow's aren't out yet | [`web/test/deadline.test.ts`](web/test/deadline.test.ts) |
| "Cheapest" is never dearer than "now": a half hour against the half hour under way, on the home page, /tables and `get_tide`; the home picker considers starting now; a saving under a penny never sends you to wait, and no answer reads "29p instead of 29p" | [`web/test/basis.test.ts`](web/test/basis.test.ts) |
| A busy site (429/503) or a dropped connection is retried with backoff and a failed Echo set-up offers Retry; the function refuses requests without CloudFront's secret; the keep-warm job can't hang | [`web/test/guard.test.ts`](web/test/guard.test.ts) |
| MCP 2026-07-28 through `server/discover` and the per-request envelope, the 2025 revisions through `initialize`; every view tool carries Alexa+'s `invoking`/`invoked` strings | [`web/test/protocol.test.ts`](web/test/protocol.test.ts) |
| Edge cases hold: refusals never schedule, past starts refused, negative prices, partial slots, abuse limits on the household and model routes | [`web/test/edges.test.ts`](web/test/edges.test.ts), 51 tests, including the real tool handlers and routes in-process |
| Postcodes and cities resolve to the right tariff; money reads naturally | [`web/test/time.test.ts`](web/test/time.test.ts) |
| The fallback router maps everyday phrasings, and "yes" schedules the plan just offered | [`web/test/fallback.test.ts`](web/test/fallback.test.ts) |
| Every tool works over Streamable HTTP against the live deployment (a tool error fails the build) | [`web/scripts/mcp-smoke.mjs`](web/scripts/mcp-smoke.mjs), run in CI |
| A full Bedrock conversation (plan → schedule → savings) works in production | [`web/scripts/alexa-turn.mjs`](web/scripts/alexa-turn.mjs) |
| The Echo flow works on desktop and phone with no console errors | [`web/scripts/e2e.cjs`](web/scripts/e2e.cjs) |
| `schedule_run` asks through MCP elicitation when the client can show a form, saves nothing on "decline", and keeps the spoken yes for clients that can't (real SDK client, in-process) | [`web/test/elicit.test.ts`](web/test/elicit.test.ts), live: [`web/scripts/elicit-smoke.mjs`](web/scripts/elicit-smoke.mjs) |
| OAuth: PKCE (the RFC 7636 vector), S256 only; codes are single use (a replay revokes the grant, two racing exchanges get one token set); refresh tokens rotate and a replayed one revokes the grant; revoking a refresh token ends its access tokens; client_credentials gives `mcp:service` only, no refresh token, resource required; tokens are bound to their household and to this origin; nothing is stored unhashed; metadata-document clients are fetched only from public addresses; `/api/mcp/account` answers 401 with `resource_metadata`, and service tokens get 403 for household tools | [`web/test/oauth.test.ts`](web/test/oauth.test.ts), 21 tests |
| The MCP SDK's own OAuth client, against `next dev`: discovers the metadata, registers, is sent to the consent page (driven by Playwright: a new household, then a pasted existing one), exchanges the code, calls `tools/list`, `plan_appliance` and `schedule_run`, refreshes after a 401, and is locked out after revocation; a client_credentials client gets `mcp:service`; the capability link and the guest endpoint still work | [`web/scripts/oauth-e2e.mjs`](web/scripts/oauth-e2e.mjs) |
| SigV4 matches botocore for Bedrock, S3 and Polly, with and without a session token; credentials come from the Lambda role on AWS | [`web/test/aws.test.ts`](web/test/aws.test.ts) |
| `/api/speak` serves Polly audio only to the site's own pages, in the region's voice, cached by text, within per-visitor and daily caps, and fails over to the browser's voice | [`web/test/aws.test.ts`](web/test/aws.test.ts) (Polly replaced by a fake) |
| Tonight's plan waits for tomorrow's prices, is computed once per household per night even when two instances race (If-Match), and the roll walks households a few at a time, skipping quiet ones; the scheduled job runs the roll to the end within its time budget, and `/events` refuses any event without this deploy's schedule token (missing, wrong or unconfigured) | [`web/test/aws.test.ts`](web/test/aws.test.ts) |
| Savings are quoted against a typical start, not the peak | [`web/test/plan.test.ts`](web/test/plan.test.ts) (`typicalCost`), live figures: [`web/scripts/impact.ts`](web/scripts/impact.ts) |
| Latency on AWS, measured on 15 October 2026 from India through CloudFront to Lambda in Sydney, four questions over two conversations: each Bedrock turn (`/api/alexa`) 1.0–1.3 s; a read-only tool over MCP 0.3–0.5 s; `schedule_run` 0.9 s (S3 read plus conditional write); a whole answered question (two model turns and a tool) 2.6–3.3 s. Amazon Polly: 1.3 s to the first byte of new speech, 1.0 s from the cache (a miss, Polly plus storing the audio in S3, adds about 0.35 s). Pages: 75–100 ms from the CloudFront edge, 0.9–1.2 s when rendered by Lambda (one 4.9 s outlier) | [`web/scripts/alexa-turn.mjs`](web/scripts/alexa-turn.mjs), `curl -w` timings |

## Run it

```bash
cd web
npm install
npm run dev          # builds the MCP App view, then starts Next.js
npm test             # 141 tests: planner, deadlines, clocks, places, the phrase router, the tool handlers, the routes, SigV4, Polly, tonight's plan, retries, the origin check, the MCP protocol revisions, OAuth
node scripts/mcp-smoke.mjs http://localhost:3000
PLAYWRIGHT=/path/to/node_modules/playwright node scripts/oauth-e2e.mjs http://localhost:3000   # OAuth end to end
```

Optional environment (see [`web/.env.example`](web/.env.example)): `S3_BUCKET` + `S3_REGION` with `AWS_ROLE_ARN` or `S3_ACCESS_KEY_ID` + `S3_SECRET_ACCESS_KEY` (households in a private Amazon S3 bucket next to Bedrock, written with `If-Match` on the ETag so two quick saves can't overwrite each other; a GCS bucket or `BLOB_READ_WRITE_TOKEN` also work; without any store they're stored in `web/.data`), `BEDROCK_ACCESS_KEY_ID` + `BEDROCK_SECRET_ACCESS_KEY` (the simulator's model, called with signed requests to `bedrock-runtime.<region>.amazonaws.com` and nowhere else; without them the phrase router answers), `BEDROCK_REGION` (default `ap-southeast-2`), `BEDROCK_MODEL`.

## What's next

- Matter smart plugs and appliance APIs, so a confirmed plan can start the machine itself.
- More tariffs: Octopus Go and Intelligent, PG&E time-of-use, Tibber; and WattTime carbon for the US.
- Real push to the device: tonight's plan is already computed on a schedule before anyone asks, but reaching a real Echo needs Alexa+ to open proactive notifications to MCP integrations (today the Echo simulator shows it as a waiting notification when you open it).

## Who pays

The household keeps the saving, but the natural buyer is the energy supplier. Suppliers with time-of-use tariffs need load moved out of the evening peak, and Britain already pays for it: the National Energy System Operator's Demand Flexibility Service had 2.46 million households and businesses signed up by March 2026, and since then the service also covers turning demand *up* when power is plentiful, not only down ([NESO, 25 March 2026](https://www.neso.energy/neso-announces-shakeup-new-look-demand-flexibility-service)). In winter 2024/25 it shifted 3,917.7 MWh and paid £943,983 to providers ([NESO](https://www.neso.energy/nearly-2-million-households-and-businesses-registered-demand-flexibility-service-dfs-last-winter)). NESO pays the providers, and each provider decides how to reward its customers. Alexa+ MCP integrations are open to brands, so the route to market is a supplier-branded Lowtide: the supplier's tariff and flexibility events in, one spoken sentence and a screen out, at the moment someone is standing at the machine.

## Alexa+ fit

How Lowtide lines up with Amazon's Alexa+ add-on guidance (the MCP Toolkit overview, client lifecycle, display modes, layout, tool design and authentication pages), checked on 18 October 2026. Where it falls short, it says so.

| Alexa+ guidance | Lowtide | Status |
|---|---|---|
| MCP 2025-11-25 over Streamable HTTP; the Alexa+ client sample initializes at 2025-03-26 | Both negotiated through `initialize`, plus 2026-07-28 natively ([`web/test/protocol.test.ts`](web/test/protocol.test.ts)) | Yes |
| MCP Apps: a `ui://` resource, and `_meta.ui.resourceUri` in the tool response so Alexa renders your UI | One self-contained HTML view (`ui://lowtide/tide-chart.html`, `text/html;profile=mcp-app`, CSP declared in `_meta.ui.csp`); `resourceUri` on 8 of the 9 tools and on each of their results | Yes |
| `_meta.ui.invoking` / `invoked` status strings in the tool response | On every view tool's definition and successful result ("Pricing every start time…" / "Found the best start") | Yes |
| Inline and fullscreen display modes; adapt to `hostContext` (`displayMode`, `deviceClass`, size) and re-adapt on `host-context-changed` | The view has an inline layout for chat hosts and a fullscreen one sized from the screen, and redraws on host context changes. Amazon's pages name no key for declaring supported modes on a resource, so none is invented | Partly: the view adapts, nothing is declared |
| Data intelligible without a screen, no formatting artifacts (pipes) | Every result leads with one sentence written to be spoken (times as people say them, money in pence or cents), no tables or markdown | Yes |
| Always return something; no dead ends | Unreadable times, unknown places and appliances, missing prices and impossible deadlines each answer with what to do next | Yes |
| One intent per tool, clear descriptions, declare only what you honour | Nine single-purpose tools; every parameter is used; all four annotations on every tool | Yes |
| Round trip under 500 ms | Warm read-only tools 0.3–0.5 s through CloudFront from India to Sydney; writes about 0.9 s (an S3 read plus a conditional write); a cold start is seconds, which the keep-warm schedule makes rare | Partly |
| Elicitation when details are missing | `schedule_run` confirms through MCP elicitation (form) where the host supports it | Yes |
| Authentication: Tier 1 `client_credentials` (scope `mcp:service`), Tier 2 `authorization_code` + PKCE | OAuth 2.1 at `/api/mcp/account`: authorization code with PKCE (S256 only) through a consent page that makes or picks a household, client credentials for `mcp:service` (no refresh token, `resource` required), rotating refresh tokens, revocation, client ID metadata documents and dynamic registration ([Sign in with OAuth](#sign-in-with-oauth-alexa-account-linking), [`web/test/oauth.test.ts`](web/test/oauth.test.ts)). Household capability links and the guest endpoint are unchanged. Not yet tested with a real Alexa+ client, because outside developers can't register an Alexa+ add-on | Yes, untested on Alexa+ |

## Feedback for the Amazon teams

The friction we hit while building is logged in [`FRICTION.md`](FRICTION.md).

---

Built for the [Amazon Build, Ship, Shape hackathon](https://amazonappdev2026.devpost.com) (Alexa+ track, AWS Builder mini challenge), October 2026. Prices: Octopus Energy, ComEd, aWATTar; carbon: National Energy System Operator. Not affiliated with Amazon, Octopus Energy or ComEd.

MIT licensed.
