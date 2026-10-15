# Friction log

Kept while building Lowtide (October 2026). Each entry: task attempted, steps taken, expected vs. actual, severity, workaround used, actionable suggestion.

## 1. Testing an MCP server on Alexa+
- **Task attempted:** See Lowtide running inside Alexa+ on an Echo Show.
- **Steps taken:** Read the hackathon resources and the Alexa+ track notes; looked for a developer console, sandbox or test-device path to register a remote MCP (Streamable HTTP) URL.
- **Expected:** A developer sandbox (even preview-only) where an outside developer can add a Streamable HTTP URL and talk to it in the Alexa app or on a test Echo.
- **Actual:** Alexa+ MCP integrations are in preview for brands only; there is no path for outside developers to connect or test a server on a real device.
- **Severity:** High (blocks testing on the target platform).
- **Workaround used:** Built an Echo Show simulator: a real MCP host in the browser (MCP client + MCP Apps AppBridge) with a model on Amazon Bedrock (Claude Haiku 4.5 at first, Amazon Nova Micro since October 7), then open-sourced it as [Countertop](https://github.com/RohanGlitched/countertop).
- **Actionable suggestion:** Offer an Alexa+ developer sandbox that accepts a Streamable HTTP URL and plays it in the Alexa app or on a test device, with MCP Apps rendered on Echo Show screens.

## 2. Knowing which MCP version and extensions Alexa+ supports
- **Task attempted:** Match the track requirement "MCP spec 2025-11-25 or later, Streamable HTTP" and design an Echo Show view.
- **Steps taken:** Built with the current MCP TypeScript SDK v2 and mcp-handler 2; searched the hackathon docs for Alexa+'s supported protocol version, MCP Apps support, screen sizes and display modes.
- **Expected:** A capability table: negotiated spec version, MCP Apps support on Echo Show, reported screen sizes and display modes, and guidance on spoken-answer length.
- **Actual:** SDK v2 serves the 2026-07-28 spec natively; nothing says which version Alexa+ negotiates or whether it renders ui:// views on screens.
- **Severity:** Medium.
- **Workaround used:** Served both protocol generations from one handler; made every tool return a spoken sentence first so the view is optional; gave the view a fullscreen device layout driven by `hostContext.displayMode` and `containerDimensions`.
- **Actionable suggestion:** Publish one Alexa+ capability table for MCP servers, and a recommended answer length for voice.

## 3. Bedrock Converse with no tools
- **Task attempted:** Call the Amazon Bedrock Converse API (Claude Haiku 4.5) from a serverless function for a turn that had no tools.
- **Steps taken:** Sent a Converse request with `toolConfig: { tools: [] }` and a Bedrock API key.
- **Expected:** Either a normal reply, or a 400 that names the invalid field.
- **Actual:** HTTP 400 "The provided request is not valid", with no field named. It took a production deploy and a log search to find the cause.
- **Severity:** Low (but cost a deploy cycle).
- **Workaround used:** Omit `toolConfig` entirely when there are no tools.
- **Actionable suggestion:** Name the offending field in Converse validation errors (e.g. "toolConfig.tools must contain at least 1 item").

## 4. Bedrock API key vs model access
- **Task attempted:** Use a Bedrock API key to call Claude Haiku 4.5 through the `us.` cross-region inference profile.
- **Steps taken:** Created the API key; looked for which models it could reach before calling.
- **Expected:** The key page shows which models and inference profiles the key can call, or links to enable them.
- **Actual:** Model access is enabled in a separate place, and the key page doesn't say what the key can reach; the inference-profile model ID had to be looked up separately.
- **Severity:** Low.
- **Workaround used:** Checked model access separately and hard-coded the inference profile ID (overridable by an env var).
- **Actionable suggestion:** On the API-key page, list reachable models and their inference-profile IDs, with a one-click link to enable access.

## 5. MCP Apps view bundle size
- **Task attempted:** Ship a small MCP App view (the day's prices on a dial) for Echo Show screens.
- **Steps taken:** Built a vanilla-TypeScript view using the `App` class from `@modelcontextprotocol/ext-apps` and bundled it with esbuild into one HTML file.
- **Expected:** A view of a few tens of kilobytes.
- **Actual:** About 600 KB, of which about 450 KB is zod pulled in by the App runtime.
- **Severity:** Low (hosts cache the resource, but it matters on devices).
- **Workaround used:** Accepted the size; kept the view's own code to about 8 KB.
- **Actionable suggestion:** Provide a zod-free (or `zod/mini`) build of the View runtime.

## 6. Hosting MCP App views in your own host
- **Task attempted:** Render Lowtide's `ui://` view on the simulated Echo Show screen.
- **Steps taken:** Followed the basic-host example, which uses a double-iframe sandbox proxy on a separate origin.
- **Expected:** Guidance for a single-origin host (one sandboxed iframe), since there is no supported reference host package.
- **Actual:** The example assumes a second origin for the proxy; the minimal safe alternative had to be worked out from the spec.
- **Severity:** Low.
- **Workaround used:** An opaque-origin iframe (`sandbox="allow-scripts"`, `srcdoc`) connected directly to `AppBridge` over `PostMessageTransport`.
- **Actionable suggestion:** Document the single-iframe opaque-origin pattern as a supported option, or ship a small host package.

## 7. Browser MCP client against a stateless server
- **Task attempted:** Connect to Lowtide's stateless Streamable HTTP server from the browser with `@modelcontextprotocol/client`.
- **Steps taken:** `StreamableHTTPClientTransport` against our mcp-handler endpoint.
- **Expected:** No errors, since the server is stateless and has no server-to-client stream.
- **Actual:** The client opens an optional GET stream, the server answers 405, and the browser logs a red console error on every connection.
- **Severity:** Low.
- **Workaround used:** A custom `fetch` that answers that GET locally with 405, so no request reaches the network.
- **Actionable suggestion:** Skip the optional GET when the negotiated protocol version is stateless, or don't log it as an error.

## 8. Calling an MCP server from a browser host on another origin
- **Task attempted:** Connect Countertop (our open-source test bench, on its own domain) to Lowtide's MCP endpoint.
- **Steps taken:** Connected from the browser to the remote endpoint.
- **Expected:** Getting-started docs to mention what browser hosts need.
- **Actual:** The browser blocks the request until the server sends CORS headers (including `mcp-session-id` and `mcp-protocol-version` in the allowed and exposed headers) and answers OPTIONS; mcp-handler doesn't add them, and the docs don't mention it.
- **Severity:** Low.
- **Workaround used:** Wrapped the handler to add CORS headers and an OPTIONS response.
- **Actionable suggestion:** An opt-in CORS option in mcp-handler, and a note in the remote-server docs listing the headers browser hosts need.

## 9. Bedrock API keys blocked by an organisation policy
- **Task attempted:** Keep the Echo simulator's model working after moving to a new AWS account that belongs to an AWS Organization.
- **Steps taken:** Generated a Bedrock API key and called the Converse API with it, as in the Bedrock API key guide.
- **Expected:** The key to work wherever the account may call Bedrock, or a clear pointer to the setting that controls it.
- **Actual:** Every call was refused with `not authorized to perform: bedrock:CallWithBearerToken ... with an explicit deny in a service control policy`, while ordinary signed (SigV4) requests from the same account to the same model succeeded. The API key guide doesn't say that organisations can block bearer tokens as a separate action, so it looked like a model-access problem at first. The organisation also allowed only one region (Sydney).
- **Severity:** Medium (the model silently fell back to the phrase router until we found it).
- **Workaround used:** Signed requests with SigV4 (a few lines of `node:crypto`), an IAM user that may only call `bedrock:InvokeModel` on Amazon Nova Micro and Nova Lite, and the APAC inference profile in ap-southeast-2. Nova Micro is also the cheapest Bedrock model with tool use.
- **Actionable suggestion:** In the Bedrock API key docs and in the error text, say that `bedrock:CallWithBearerToken` can be denied by an SCP and that SigV4 credentials still work; a console check ("API keys are blocked for this account") would save the hunt.

## 10. Keyless access from Vercel blocked by an organisation policy
- **Task attempted:** Give the Vercel functions access to Lowtide's Amazon S3 bucket without a long-lived key, by trusting Vercel's OIDC issuer from an IAM role (AssumeRoleWithWebIdentity), the pattern we already use for Google Cloud.
- **Steps taken:** Wrote the federation path (`web/lib/storage.ts` exchanges the function's Vercel OIDC token at the regional STS endpoint), then tried to create the IAM OIDC identity provider for Vercel's issuer in the account.
- **Expected:** An OIDC provider and a role whose trust policy names this one Vercel project, so no access key exists anywhere.
- **Actual:** The organisation's service control policy denies creating IAM OIDC providers, so the keyless path can't be set up in this account. The refusal is an explicit deny from the organisation, which a member account can't change.
- **Severity:** Medium (forced a static access key onto a third-party host).
- **Workaround used:** An IAM user, `lowtide-store`, with one inline policy (get, put and delete objects in one bucket, and list that bucket), its key stored as a sensitive Vercel variable, and a note to rotate it after judging. The keyless code path stays in the repo for accounts that allow it.
- **Actionable suggestion:** In the IAM console, show when an SCP blocks identity-provider creation before the form is filled in, and suggest an allowed alternative (for example, IAM Roles Anywhere or a request to the organisation's administrator) in the error.

## 11. S3 conditional writes: two different answers for "someone else wrote first"
- **Task attempted:** Make every household update a safe read-modify-write: read the JSON object, change it, and write it back only if nobody else changed it in between (`If-Match` on the ETag).
- **Steps taken:** Moved storage from Vercel Blob to S3 and sent `PutObject` with `If-Match` from SigV4-signed requests.
- **Expected:** One status code for a lost race, so one retry path.
- **Actual:** S3 answers `412 Precondition Failed` when the ETag no longer matches, and `409 ConditionalRequestConflict` when a conflicting write is still in flight, and the PutObject reference gives different advice for each (re-read and recompute, or fetch the ETag and retry). A client that only handles 412, the code most HTTP libraries treat as "precondition failed", can surface a 409 to the user as a hard error.
- **Severity:** Low (documented, but easy to miss).
- **Workaround used:** Treat 412 and 409 the same way: re-read the object, re-apply the change and retry with backoff, and after five tries tell the person to try again rather than overwrite (`web/lib/store.ts`, `web/lib/storage.ts`).
- **Actionable suggestion:** Put one "conditional update with retry" example in the S3 user guide that handles both codes, or offer a single retryable code for both cases.

## 12. Amazon Nova's reasoning text in the spoken answer
- **Task attempted:** Use Amazon Nova Micro through the Converse API as the Echo simulator's model and speak its text blocks aloud.
- **Steps taken:** Switched the model from Claude Haiku 4.5 to Nova Micro with the same tool list and system prompt.
- **Expected:** Text content blocks that hold only the answer, with any reasoning kept out of them (or in its own block type).
- **Actual:** In tool-use turns Nova Micro sometimes writes its reasoning inside `<thinking>…</thinking>` in the same text block as the answer, so the simulated Alexa would have read its reasoning out loud. It also tended to repeat phrases from the system prompt back to the user.
- **Severity:** Medium for a voice product (reasoning read aloud sounds broken).
- **Workaround used:** Strip `<thinking>` blocks (closed or not) before anything is spoken, drop text blocks left empty, and tighten the system prompt (`web/lib/alexa/bedrock.ts`).
- **Actionable suggestion:** Return Nova's reasoning in a separate `reasoningContent` block in Converse, as other reasoning models on Bedrock do, or add an option to leave it out, and document in the Nova tool-use guide that text blocks can contain `<thinking>` tags.

## 13. Next.js on Lambda: a read-only file system the framework expects to write to
- **Task attempted:** Run Lowtide's unmodified Next.js 15 standalone server on AWS Lambda (Node.js 22, arm64) through the Lambda Web Adapter, with pages that revalidate every five minutes (ISR) and cached `fetch()` calls for the price feeds.
- **Steps taken:** Built with `output: "standalone"`, packaged the server with its traced `node_modules`, and ran the package on Linux with the application directory mounted read-only, as Lambda does, before deploying.
- **Expected:** A guide for running a framework server on Lambda to list the paths it will try to write, or the Web Adapter's Next.js example to set up a cache that works on Lambda.
- **Actual:** Next.js writes revalidated pages and its fetch cache under `.next/` next to the server, and Lambda's file system is read-only everywhere except `/tmp`, so those writes fail as soon as a page revalidates. The read-only file system is documented for Lambda in general, but the fix for a framework server shipped as a zip (move its cache, or replace it) has to be pieced together from container examples and framework issues.
- **Severity:** Low (found before deploying, but only because we tested on a read-only mount).
- **Workaround used:** A small, bounded in-memory cache handler (`web/cache-handler.cjs`, at most 400 entries per instance) set through Next's `cacheHandler` with `cacheMaxMemorySize: 0`; CloudFront caches the pages in front, so a cold instance simply renders again. Images are served unoptimised, so no native `sharp` binary is needed and a package built on Windows runs unchanged on Linux arm64.
- **Actionable suggestion:** In the Lambda Web Adapter's Next.js example, cover the zip (layer) deployment as well as the container one, say that only `/tmp` is writable, and show a cache handler (in memory, `/tmp`, or S3) next to the notes on ports and readiness checks.
