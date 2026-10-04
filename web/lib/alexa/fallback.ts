import type { Message, TurnResponse } from "./types";
import { findAppliance } from "../appliances";

/**
 * A small deterministic intent router used when the model is unavailable (no key, over the daily cap,
 * or Bedrock down). It speaks the same MCP tools, and Lowtide's tool results are already written to be
 * read aloud, so the experience degrades to "fewer phrasings understood", not "broken".
 */
export function fallbackTurn(messages: Message[]): TurnResponse {
  const last = messages[messages.length - 1];
  const results = last?.content.filter((b): b is Extract<typeof b, { toolResult: unknown }> => "toolResult" in b) ?? [];
  if (results.length) {
    // Speak the first line of the tool's answer.
    const text = results
      .map((r) => r.toolResult.content[0]?.text ?? "")
      .join(" ")
      .trim();
    const asked = messages
      .flatMap((m) => m.content)
      .some((b) => "toolUse" in b && b.toolUse.name === "plan_appliance" && results.some((r) => r.toolResult.toolUseId === b.toolUse.toolUseId));
    const ok = results.every((r) => r.toolResult.status !== "error");
    return say((text || "Done.") + (asked && ok ? " Want me to set a reminder?" : ""));
  }
  const utterance = (last?.content.find((b): b is { text: string } => "text" in b)?.text ?? "").toLowerCase();
  const call = route(utterance, messages);
  if (!call) {
    return say(
      "I can tell you when electricity is cheapest, whether now is a good time, or when to run the dishwasher, washing machine, dryer or car charger.",
    );
  }
  return {
    message: { role: "assistant", content: [{ toolUse: { toolUseId: `fb-${Date.now().toString(36)}`, name: call.name, input: call.input } }] },
    stop: "tool_use",
    engine: "fallback",
  };
}

function route(u: string, history: Message[]): { name: string; input: Record<string, unknown> } | null {
  const appliance = findAppliance(u);
  const time = u.match(/\b(?:by|before|until)\s+(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?|noon|midnight)/)?.[1];
  const after = u.match(/\b(?:after|from)\s+(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?|noon|midnight)/)?.[1];
  const goal = /green|clean|carbon|planet/.test(u) ? "greenest" : undefined;

  if (/\b(yes|yeah|yep|do it|sounds good|schedule it|book it|go ahead|please do|ok(ay)?)\b/.test(u)) {
    const plan = lastPlan(history);
    if (plan) return { name: "schedule_run", input: { appliance: plan.appliance, start: plan.start } };
  }
  if (/\b(cancel|don'?t run|forget)\b/.test(u) && appliance) return { name: "cancel_run", input: { appliance: appliance.name } };
  if (/\b(sav(ed|ing|ings)|how much have i)\b/.test(u)) return { name: "get_savings", input: {} };
  if (/\b(planned|scheduled|what'?s (on|coming)|my runs|reminders?)\b/.test(u)) return { name: "list_runs", input: {} };
  // "Is now a good time to use the dryer?" asks about now, not for a plan.
  if (/\b(is (it|now)|now) (a )?(good|bad|cheap|ok(ay)?) time\b|\bright now\b|\bat the moment\b/.test(u)) return { name: "check_now", input: {} };
  if (appliance) {
    const input: Record<string, unknown> = { appliance: appliance.name };
    if (time) input.finish_by = time;
    if (after) input.start_after = after;
    if (goal) input.goal = goal;
    const kwh = u.match(/(\d{1,3})\s*(?:kwh|kilowatt)/)?.[1];
    if (kwh && appliance.id === "ev") input.kwh = Number(kwh);
    return { name: "plan_appliance", input };
  }
  if (/\b(right now|now a good|good time|should i use|is it cheap now|now)\b/.test(u)) return { name: "check_now", input: {} };
  if (/\b(cheap|cheapest|price|tide|tonight|tomorrow|electricity|power|energy)\b/.test(u)) return { name: "get_tide", input: {} };
  return null;
}

/** The appliance and start of the most recent plan_appliance answer, for "yes, do it". */
function lastPlan(history: Message[]): { appliance: string; start: string } | null {
  for (let i = history.length - 1; i >= 0; i--) {
    for (const b of history[i].content) {
      if ("toolResult" in b) {
        const joined = b.toolResult.content.map((c) => c.text).join(" ");
        const start = joined.match(/pass start "([^"]+)"/)?.[1];
        if (start) {
          const use = history
            .flatMap((m) => m.content)
            .find((x) => "toolUse" in x && x.toolUse.toolUseId === b.toolResult.toolUseId) as
            | { toolUse: { input: Record<string, unknown> } }
            | undefined;
          const appliance = String(use?.toolUse.input.appliance ?? "");
          if (appliance) return { appliance, start };
        }
      }
    }
  }
  return null;
}

function say(text: string): TurnResponse {
  return { message: { role: "assistant", content: [{ text }] }, stop: "end_turn", engine: "fallback" };
}
