import { bedrockReady, bedrockStatus, bedrockTurn, systemPrompt } from "@/lib/alexa/bedrock";
import { ipAllowed, takeDaily } from "@/lib/alexa/budget";
import { fallbackTurn } from "@/lib/alexa/fallback";
import { LOWTIDE_TOOLS, type Message, type ToolSpec, type TurnRequest, type TurnResponse } from "@/lib/alexa/types";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_MESSAGES = 40;
const MAX_BYTES = 32_000;
const allowed = new Set<string>(LOWTIDE_TOOLS);

/** Only this site's own pages may spend the Bedrock budget: the request's Origin must be this host. */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Bedrock message shapes only; anything else is a 400, not a crash. */
function cleanMessages(raw: unknown): Message[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Message[] = [];
  for (const m of raw.slice(-MAX_MESSAGES)) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || !Array.isArray(m.content)) return null;
    for (const b of m.content) {
      if (!b || typeof b !== "object") return null;
      if ("text" in b && typeof b.text !== "string") return null;
      if ("toolUse" in b && (typeof b.toolUse?.name !== "string" || typeof b.toolUse?.toolUseId !== "string")) return null;
      if ("toolResult" in b && (typeof b.toolResult?.toolUseId !== "string" || !Array.isArray(b.toolResult?.content))) return null;
    }
    out.push(m as Message);
  }
  // Never hand Bedrock a tool call whose result was trimmed away.
  while (out.length && !(out[0].role === "user" && out[0].content.some((b) => "text" in b))) out.shift();
  return out;
}

/** The Lowtide tools only, with their own descriptions and schemas kept to a sane size. */
function cleanTools(raw: unknown): ToolSpec[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ToolSpec[] = [];
  for (const t of raw) {
    if (!t || typeof t.name !== "string" || !allowed.has(t.name) || seen.has(t.name)) continue;
    const description = typeof t.description === "string" ? t.description.slice(0, 800) : t.name;
    const schema = t.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : { type: "object" };
    if (JSON.stringify(schema).length > 3000) continue;
    seen.add(t.name);
    out.push({ name: t.name, description, inputSchema: schema });
  }
  return out;
}

/**
 * One model turn for the Echo Show simulator. The browser is the host: it holds the conversation, runs
 * the MCP tool calls itself and renders their views; this route only decides the next step.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "This endpoint serves the Lowtide site only. Run your own copy with your own Bedrock key." }, { status: 403 });
  const raw = await req.text();
  if (Buffer.byteLength(raw) > MAX_BYTES) return Response.json({ error: "That conversation is too long. Start a new one." }, { status: 413 });
  let body: TurnRequest;
  try {
    body = JSON.parse(raw) as TurnRequest;
  } catch {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }
  const messages = cleanMessages(body?.messages);
  if (!messages || !messages.length) return Response.json({ error: "Say something first." }, { status: 400 });
  const tools = cleanTools(body.tools);
  const tz = typeof body.timeZone === "string" && body.timeZone.length < 40 ? body.timeZone : "Europe/London";
  const place = typeof body.place === "string" ? body.place.slice(0, 40) : undefined;

  let note: string | undefined;
  if (bedrockReady()) {
    const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
    if (!ipAllowed(ip)) note = "You've used the voice model a lot today, so I'm on simple commands for a bit.";
    else if (!(await takeDaily())) note = "Today's voice-model budget is used up, so I'm on simple commands until tomorrow.";
    else {
      try {
        const turn = await bedrockTurn(messages, tools, systemPrompt(tz, place));
        return Response.json({ message: turn.message, stop: turn.stop, engine: "bedrock", model: turn.model } satisfies TurnResponse);
      } catch (e) {
        console.error("bedrock", e instanceof Error ? e.message : e);
        note = "The voice model isn't available right now, so I'm on simple commands.";
      }
    }
  }
  const turn = fallbackTurn(messages);
  return Response.json({ ...turn, note } satisfies TurnResponse);
}

/** What the simulator should say it is running on. Probes Bedrock, so the label is true, not hopeful. */
export async function GET() {
  return Response.json(await bedrockStatus(), { headers: { "cache-control": "no-store" } });
}
