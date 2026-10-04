import { bedrockReady, bedrockTurn, systemPrompt } from "@/lib/alexa/bedrock";
import { ipAllowed, takeDaily } from "@/lib/alexa/budget";
import { fallbackTurn } from "@/lib/alexa/fallback";
import { LOWTIDE_TOOLS, type Message, type TurnRequest, type TurnResponse } from "@/lib/alexa/types";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_MESSAGES = 40;
const MAX_BYTES = 60_000;
const allowed = new Set<string>(LOWTIDE_TOOLS);

/**
 * One model turn for the Echo Show simulator. The browser is the host: it holds the conversation, runs
 * the MCP tool calls itself and renders their views; this route only decides the next step.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return Response.json({ error: "That conversation is too long. Start a new one." }, { status: 413 });
  let body: TurnRequest;
  try {
    body = JSON.parse(raw) as TurnRequest;
  } catch {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }
  const messages = (body.messages ?? []).slice(-MAX_MESSAGES) as Message[];
  if (!messages.length || messages[0].role !== "user") {
    return Response.json({ error: "Say something first." }, { status: 400 });
  }
  const tools = (body.tools ?? []).filter((t) => allowed.has(t.name)).slice(0, LOWTIDE_TOOLS.length);
  const tz = typeof body.timeZone === "string" && body.timeZone.length < 40 ? body.timeZone : "Europe/London";

  let note: string | undefined;
  if (bedrockReady()) {
    const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
    if (!ipAllowed(ip)) note = "You've used the voice model a lot in the last few minutes, so I'm on simple commands for a bit.";
    else if (!(await takeDaily())) note = "Today's voice-model budget is used up, so I'm on simple commands until tomorrow.";
    else {
      try {
        const turn = await bedrockTurn(messages, tools, systemPrompt(tz, body.place?.slice(0, 40)));
        return Response.json({ message: turn.message, stop: turn.stop, engine: "bedrock" } satisfies TurnResponse);
      } catch (e) {
        console.error("bedrock", e);
        note = "The voice model didn't answer, so I'm on simple commands.";
      }
    }
  }
  const turn = fallbackTurn(messages);
  return Response.json({ ...turn, note } satisfies TurnResponse);
}

export async function GET() {
  return Response.json({ engine: bedrockReady() ? "bedrock" : "fallback" });
}
