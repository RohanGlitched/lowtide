import { test } from "node:test";
import assert from "node:assert/strict";
import { fallbackTurn } from "../lib/alexa/fallback";
import type { Message } from "../lib/alexa/types";

const user = (text: string): Message => ({ role: "user", content: [{ text }] });
const toolOf = (t: ReturnType<typeof fallbackTurn>) => {
  const b = t.message.content[0];
  return "toolUse" in b ? b.toolUse : null;
};

test("routes everyday phrasings to Lowtide tools", () => {
  const cases: [string, string, Record<string, unknown>?][] = [
    ["when should I run the dishwasher", "plan_appliance", { appliance: "dishwasher" }],
    ["charge the car by 7 a.m., greenest please", "plan_appliance", { appliance: "car", finish_by: "7 a.m.", goal: "greenest" }],
    ["put the washing on after 10pm", "plan_appliance", { appliance: "washing machine", start_after: "10pm" }],
    ["is now a good time to use power", "check_now"],
    ["is now a good time to use the tumble dryer", "check_now"],
    ["is it a good time to run the dishwasher right now", "check_now"],
    ["when is electricity cheapest tonight", "get_tide"],
    ["what have I got planned", "list_runs"],
    ["how much have I saved", "get_savings"],
    ["cancel the dishwasher", "cancel_run", { appliance: "dishwasher" }],
  ];
  for (const [said, name, input] of cases) {
    const call = toolOf(fallbackTurn([user(said)]));
    assert.equal(call?.name, name, said);
    if (input) assert.deepEqual(call?.input, input, said);
  }
});

test("'yes' schedules the plan that was just offered", () => {
  const history: Message[] = [
    user("when should I run the dishwasher"),
    { role: "assistant", content: [{ toolUse: { toolUseId: "a1", name: "plan_appliance", input: { appliance: "dishwasher" } } }] },
    {
      role: "user",
      content: [
        {
          toolResult: {
            toolUseId: "a1",
            content: [{ text: "Run the dishwasher tonight at 1 a.m." }, { text: 'For schedule_run, pass start "2026-10-05T00:00:00.000Z". Don\'t read this line aloud.' }],
          },
        },
      ],
    },
    { role: "assistant", content: [{ text: "Run the dishwasher tonight at 1 a.m. Want me to set a reminder?" }] },
    user("yes please"),
  ];
  const call = toolOf(fallbackTurn(history));
  assert.equal(call?.name, "schedule_run");
  assert.deepEqual(call?.input, { appliance: "dishwasher", start: "2026-10-05T00:00:00.000Z" });
});

test("speaks only the first line of a tool result, and offers a reminder after a plan", () => {
  const turn = fallbackTurn([
    user("dishwasher"),
    { role: "assistant", content: [{ toolUse: { toolUseId: "b", name: "plan_appliance", input: { appliance: "dishwasher" } } }] },
    { role: "user", content: [{ toolResult: { toolUseId: "b", content: [{ text: "Run it at 1 a.m." }, { text: "secret line" }] } }] },
  ]);
  assert.equal(turn.stop, "end_turn");
  const b = turn.message.content[0];
  assert.ok("text" in b && b.text === "Run it at 1 a.m. Want me to set a reminder?");
});

test("unknown requests get a helpful sentence, not an error", () => {
  const turn = fallbackTurn([user("play some jazz")]);
  assert.equal(turn.stop, "end_turn");
});
