import "server-only";
import type { Message, ToolSpec, TurnResponse } from "./types";

/**
 * Amazon Bedrock Converse API with a Bedrock API key (bearer token). Default model: Claude Haiku 4.5
 * through the US cross-region inference profile, which keeps each voice turn fast and cheap.
 */
const REGION = process.env.BEDROCK_REGION || "us-east-1";
const MODEL = process.env.BEDROCK_MODEL || "us.anthropic.claude-haiku-4-5-20251001-v1:0";

export const bedrockReady = () => Boolean(process.env.AWS_BEARER_TOKEN_BEDROCK);
export const bedrockModel = MODEL;

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
For anything about electricity prices, the grid, or when to run appliances, use the Lowtide tools rather than guessing. After plan_appliance, give the time and the saving, then offer to set a reminder. Only call schedule_run after the person agrees, passing the start time plan_appliance gave you.
Tool results may contain lines marked "Don't read this line aloud": use them, never say them.
If a tool returns an error, say what to do next in one sentence. For unrelated requests, say briefly that you can help with electricity prices and timing appliances here.`;
}

interface ConverseOutput {
  output?: { message?: Message };
  stopReason?: string;
  usage?: { inputTokens: number; outputTokens: number };
  message?: string;
}

export async function bedrockTurn(messages: Message[], tools: ToolSpec[], system: string): Promise<TurnResponse & { usage?: ConverseOutput["usage"] }> {
  const res = await fetch(`https://bedrock-runtime.${REGION}.amazonaws.com/model/${encodeURIComponent(MODEL)}/converse`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.AWS_BEARER_TOKEN_BEDROCK}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      system: [{ text: system }],
      messages,
      toolConfig: { tools: tools.map((t) => ({ toolSpec: { name: t.name, description: t.description, inputSchema: { json: t.inputSchema } } })) },
      inferenceConfig: { maxTokens: 400, temperature: 0.3 },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => ({}))) as ConverseOutput;
  if (!res.ok || !body.output?.message) {
    throw new Error(`Bedrock ${res.status}: ${body.message ?? "no message"}`);
  }
  return {
    message: body.output.message,
    stop: body.stopReason === "tool_use" ? "tool_use" : "end_turn",
    engine: "bedrock",
    usage: body.usage,
  };
}
