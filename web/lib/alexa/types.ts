/** Bedrock Converse message shapes (the subset Lowtide uses). */
export type Block =
  | { text: string }
  | { toolUse: { toolUseId: string; name: string; input: Record<string, unknown> } }
  | { toolResult: { toolUseId: string; content: { text: string }[]; status?: "success" | "error" } };

export interface Message {
  role: "user" | "assistant";
  content: Block[];
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface TurnRequest {
  messages: Message[];
  tools: ToolSpec[];
  timeZone?: string;
  place?: string;
}

export interface TurnResponse {
  message: Message;
  stop: "tool_use" | "end_turn";
  engine: "bedrock" | "fallback";
  /** The model's plain name when the engine is Bedrock, e.g. "Claude Haiku 4.5". */
  model?: string;
  note?: string;
}

export const LOWTIDE_TOOLS = [
  "get_tide",
  "check_now",
  "plan_appliance",
  "schedule_run",
  "list_runs",
  "cancel_run",
  "get_savings",
  "set_home",
] as const;
