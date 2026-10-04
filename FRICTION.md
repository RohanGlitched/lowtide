# Friction log

Kept while building Lowtide (Oct 2026). Each entry: what I tried, what happened, severity, workaround, suggestion.

## 1. Alexa+ MCP integrations can't be tested against a real Echo
- **Tried:** to connect the Lowtide MCP server to Alexa+ on a device.
- **Expected:** a developer path (even a sandbox) to register a remote MCP server with Alexa+.
- **Happened:** Alexa+ MCP integrations are in preview for brands only; outside developers have no way to see their server inside Alexa+.
- **Severity:** high. **Workaround:** built an Echo Show simulator (MCP client + MCP Apps host in the browser, Claude Haiku on Bedrock as the model).
- **Suggestion:** a developer sandbox that accepts a Streamable HTTP URL and plays it on the Alexa app or a test device, with MCP Apps rendered on Echo Show screens.

## 2. Which MCP spec version Alexa+ expects
- **Tried:** to match "spec 2025-11-25 or later" from the hackathon page.
- **Happened:** the current TypeScript SDK (v2) and `mcp-handler` 2.x serve the 2026-07-28 spec natively and fall back to 2025-era stateless Streamable HTTP. It wasn't clear which one Alexa+ negotiates, or whether it supports MCP Apps (`ui://` resources) on Echo Show.
- **Severity:** medium. **Workaround:** serve both from one handler; keep the view optional (every tool also returns a spoken sentence).
- **Suggestion:** publish Alexa+'s supported protocol versions and extensions (MCP Apps, elicitation) in one table.

## 3. Bedrock Converse: "The provided request is not valid" for an empty tool list
- **Tried:** a Converse call with `toolConfig: { tools: [] }`.
- **Happened:** HTTP 400 with only "The provided request is not valid", no field named.
- **Severity:** low, but it cost a deploy cycle. **Workaround:** omit `toolConfig` when there are no tools.
- **Suggestion:** name the offending field in validation errors.

## 4. Bedrock API keys are easy, model access is a separate step
- **Note:** bearer-token API keys made Bedrock one `fetch` from a Vercel function, no SigV4 or SDK. Good.
- **Suggestion:** say in the API-key page which models the key can reach, and link straight to enabling model access.

## 5. MCP Apps view bundle size
- **Happened:** a minimal view using `@modelcontextprotocol/ext-apps` (the `App` class) bundles to ~600 KB, most of it zod.
- **Severity:** low (hosts cache the resource). **Suggestion:** a zod-free or `zod/mini` build of the View runtime.

## 6. Browser MCP client logs a 405 against a stateless server
- **Happened:** the Streamable HTTP client opens an optional GET stream; a stateless server answers 405 and the browser logs a red console error.
- **Workaround:** a custom `fetch` that answers that GET locally.
- **Suggestion:** skip the GET when the server advertised a stateless protocol version.
