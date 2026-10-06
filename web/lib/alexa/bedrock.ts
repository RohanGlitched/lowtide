import "server-only";
import { sigv4Headers } from "./sigv4";
import type { Message, ToolSpec, TurnResponse } from "./types";

/**
 * Amazon Bedrock Converse API with a Bedrock API key (bearer token). The preferred model is Amazon Nova Micro,
 * the cheapest Bedrock model with tool use, through the US cross-region inference profile; if the account can't
 * call it (model access not enabled, an organisation policy, a region rule) the next model in the chain is tried
 * and remembered, so the demo keeps a real model for as long as any of them is allowed.
 */
const REGION = process.env.BEDROCK_REGION || "us-east-1";
const PREFERRED = process.env.BEDROCK_MODEL || "us.amazon.nova-micro-v1:0";
const CHAIN = [...new Set([PREFERRED, "amazon.nova-micro-v1:0", "us.amazon.nova-lite-v1:0", "amazon.nova-lite-v1:0"])];
const LABELS: [RegExp, string][] = [
  [/claude-haiku-4-5/, "Claude Haiku 4.5"],
  [/claude-3-5-haiku/, "Claude 3.5 Haiku"],
  [/nova-lite/, "Amazon Nova Lite"],
  [/nova-micro/, "Amazon Nova Micro"],
];

// IAM credentials (signed requests) when set, otherwise a Bedrock API key (bearer token)
const iam = () => (process.env.BEDROCK_ACCESS_KEY_ID && process.env.BEDROCK_SECRET_ACCESS_KEY ? { id: process.env.BEDROCK_ACCESS_KEY_ID, secret: process.env.BEDROCK_SECRET_ACCESS_KEY } : null);
export const bedrockReady = () => Boolean(iam() || process.env.AWS_BEARER_TOKEN_BEDROCK);
export const bedrockModel = PREFERRED;
export const modelLabel = (id: string) => LABELS.find(([re]) => re.test(id))?.[1] ?? id;

let active = 0; // index into CHAIN of the model that last worked

export function systemPrompt(timeZone: string, place?: string): string {
  const now = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
  return `You are Alexa on an Echo Show in a family kitchen, with the Lowtide skill connected over MCP.
It is ${now} where the household lives (${timeZone})${place ? `; their home is ${place}` : ""}.
Speak the way Alexa does: warm, brief, one or two short sentences, no lists, no markdown, no emoji. The screen shows Lowtide's chart, so never read tables or many numbers aloud.
For anything about electricity prices, the grid, or when to run appliances, use the Lowtide tools rather than guessing. After plan_appliance, say the time and, if the result gives one, the cost or saving exactly as the result words it (a cost is not a saving), then ask whether to save it. Only call schedule_run after the person agrees, passing the appliance plus exactly the start (and minutes, if given) that the tool result tells you to pass; never guess anything else. If they say no, don't save anything.
Tool results may contain lines marked "Don't read this line aloud": use them, never say them.
If a tool returns an error, say what to do next in one sentence. For unrelated requests (weather, music, timers), say briefly that here you can help with electricity prices and timing appliances.`;
}

interface ConverseOutput {
  output?: { message?: Message };
  stopReason?: string;
  usage?: { inputTokens: number; outputTokens: number };
  message?: string;
  Message?: string;
}

/** A refusal that is about this model rather than this request (policy, access, retired, unknown): try the next one. */
const notAllowed = (status: number, text: string) =>
  status === 404 ||
  ((status === 403 || status === 400) && /not authorized|AccessDenied|explicit deny|model access|not supported|isn't supported|don't have access|ResourceNotFound|inference profile|end of its life|invocation of model id|on-demand throughput/i.test(text));

async function converse(model: string, body: Record<string, unknown>) {
  const url = `https://bedrock-runtime.${REGION}.amazonaws.com/model/${encodeURIComponent(model)}/converse`;
  const payload = JSON.stringify(body);
  const creds = iam();
  const res = await fetch(url, {
    method: "POST",
    headers: creds
      ? { ...sigv4Headers(url, payload, REGION, creds.id, creds.secret), accept: "application/json" }
      : { authorization: `Bearer ${process.env.AWS_BEARER_TOKEN_BEDROCK}`, "content-type": "application/json", accept: "application/json" },
    body: payload,
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as ConverseOutput;
  return { res, json, text: json.message ?? json.Message ?? JSON.stringify(json).slice(0, 300) };
}

/** Runs the request on the first model in the chain the account may call, starting from the last one that worked. */
async function withChain<T>(fn: (model: string) => Promise<{ ok: boolean; status: number; text: string; value?: T }>): Promise<{ model: string; value: T }> {
  let lastError = "";
  for (let i = 0; i < CHAIN.length; i++) {
    const idx = (active + i) % CHAIN.length;
    const model = CHAIN[idx];
    const r = await fn(model);
    if (r.ok) {
      if (idx !== active) console.warn(`bedrock: using ${model} (${CHAIN[active]} refused)`);
      active = idx;
      return { model, value: r.value as T };
    }
    lastError = `Bedrock ${r.status} on ${model}: ${r.text}`;
    if (!notAllowed(r.status, r.text)) break;
  }
  throw new Error(lastError || "Bedrock didn't answer.");
}

export async function bedrockTurn(messages: Message[], tools: ToolSpec[], system: string): Promise<TurnResponse & { usage?: ConverseOutput["usage"] }> {
  const body = {
    system: [{ text: system }],
    messages,
    // Bedrock rejects an empty tool list, so only send toolConfig when there are tools.
    ...(tools.length ? { toolConfig: { tools: tools.map((t) => ({ toolSpec: { name: t.name, description: t.description, inputSchema: { json: t.inputSchema } } })) } } : {}),
    inferenceConfig: { maxTokens: 400, temperature: 0.3 },
  };
  const { model, value } = await withChain<ConverseOutput>(async (m) => {
    const { res, json, text } = await converse(m, body);
    return { ok: res.ok && Boolean(json.output?.message), status: res.status, text, value: json };
  });
  return {
    message: spoken(value.output!.message!),
    stop: value.stopReason === "tool_use" ? "tool_use" : "end_turn",
    engine: "bedrock",
    model: modelLabel(model),
    usage: value.usage,
  };
}

/** Nova wraps its reasoning in <thinking> tags; Alexa must only say the rest. */
function spoken(message: Message): Message {
  const content = message.content
    .map((b) => ("text" in b ? { text: b.text.replace(/<thinking>[\s\S]*?(<\/thinking>|$)/g, "").trim() } : b))
    .filter((b) => !("text" in b) || b.text.length > 0);
  return { ...message, content: content.length ? content : [{ text: "Sorry, I didn't catch that. Could you say it again?" }] };
}

let probe: { at: number; model: string | null } | null = null;

/** Which model this deployment can really call right now (one tiny request, remembered for five minutes). */
export async function bedrockStatus(): Promise<{ engine: "bedrock" | "fallback"; model?: string }> {
  if (!bedrockReady()) return { engine: "fallback" };
  if (probe && Date.now() - probe.at < 5 * 60_000) return probe.model ? { engine: "bedrock", model: probe.model } : { engine: "fallback" };
  try {
    const { model } = await withChain<true>(async (m) => {
      const { res, json, text } = await converse(m, {
        messages: [{ role: "user", content: [{ text: "Reply with the single word ok." }] }],
        inferenceConfig: { maxTokens: 5, temperature: 0 },
      });
      return { ok: res.ok && Boolean(json.output?.message), status: res.status, text, value: true };
    });
    probe = { at: Date.now(), model: modelLabel(model) };
    return { engine: "bedrock", model: probe.model! };
  } catch (e) {
    console.error("bedrock probe", e instanceof Error ? e.message : e);
    probe = { at: Date.now(), model: null };
    return { engine: "fallback" };
  }
}
