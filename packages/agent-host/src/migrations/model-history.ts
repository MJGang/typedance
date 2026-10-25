import type { AgentMessage, AgentRunEvent } from "@typedance/contracts";
import { harnessToolCallSchema, harnessToolResultSchema, type HarnessModelMessage } from "@typedance/harness-contracts";
import type { HarnessRuntime } from "@typedance/harness-core";
import type { AgentHostStore } from "../store";
import { toModelMessage } from "../model-history";

/** Historical UI transcripts are converted once, never used as the live history source. */
export function migrateModelHistory(store: AgentHostStore, runtime: HarnessRuntime): void {
  const conversations = new Set(store.listRuns().map((run) => run.conversation_id));
  for (const conversationId of conversations) {
    const runs = store.listRuns(conversationId);
    if (runs.some((run) => runtime.getCheckpoint(run.id))) continue;
    const latest = runs.at(-1)!;
    const messages = store.listMessages(conversationId);
    const history: HarnessModelMessage[] = [{ role: "user", content: "Historical transcript imported once. Tool observations may be stale or incomplete; inspect current authoritative state before acting. Historical images absent from tool events cannot be treated as current visual evidence.", internal: "completion" }];
    const byId = new Map(messages.map((message) => [message.id, message]));
    const included = new Set<string>();
    for (const message of messages) {
      if (included.has(message.id) || (message.role === "user" && message.run_id)) continue;
      included.add(message.id);
      if (message.role !== "assistant" || !message.run_id) history.push(toModelMessage(message));
      else history.push(...importRunEvents(store.listRunEvents(message.run_id), message, byId, included));
    }
    for (const message of messages) if (!included.has(message.id)) history.push(toModelMessage(message));
    runtime.importHistory({
      run: { id: latest.id, status: latest.status === "cancelled" ? "canceled" : latest.status,
        created_at: latest.started_at, updated_at: latest.completed_at ?? latest.started_at,
        capability_policy: { scope_ids: [], plugin_ids: [] } },
      agent_id: "historical-import", objective: messages.find((message) => message.role === "user")?.content || "Historical conversation",
      model: latest.model, prompt: { developer: [], contextual: [], conversation: history }, plan: [], step: 0,
      tokens_used: 0, compactions: 0, phase: "history", pending_tool_calls: [], pending_inputs: [], unconfirmed_input_ids: [],
      input_ids: messages.map((message) => message.id),
    });
  }
}

function importRunEvents(events: AgentRunEvent[], message: AgentMessage, byId: Map<string, AgentMessage>, included: Set<string>): HarnessModelMessage[] {
  const history: HarnessModelMessage[] = [];
  let responseId: unknown;
  for (const event of events) {
    if (event.type === "assistant_delta") {
      const last = history.at(-1);
      const delta = String(event.payload.delta ?? "");
      if (last?.role === "assistant" && responseId === event.payload.message_id && !last.toolCalls?.length) last.content += delta;
      else history.push({ role: "assistant", content: delta });
      responseId = event.payload.message_id;
    } else if (event.type === "user_input_applied") {
      const steering = byId.get(String(event.payload.message_id));
      if (steering && !included.has(steering.id)) { history.push(toModelMessage(steering)); included.add(steering.id); }
      responseId = undefined;
    } else if (event.type === "tool_call_started") {
      const parsed = harnessToolCallSchema.safeParse(event.payload.tool_call);
      if (!parsed.success) continue;
      const call = parsed.data;
      history.push({ role: "assistant", content: "", toolCalls: [call] });
      const result = events.find((candidate) => (candidate.type === "tool_call_completed" || candidate.type === "tool_call_failed")
        && (candidate.payload.result as { tool_call_id?: string } | undefined)?.tool_call_id === call.id);
      const output = harnessToolResultSchema.safeParse(result?.payload.result);
      history.push({ role: "tool", toolCallId: call.id, toolName: call.name, content: output.success ? JSON.stringify(output.data)
        : "Historical invocation has no recorded result and may have taken effect. Inspect authoritative state; do not blindly repeat it." });
      responseId = undefined;
    }
  }
  if (!events.some((event) => event.type === "assistant_delta") && message.content) history.push(toModelMessage(message));
  for (const steering of byId.values()) {
    if (steering.role === "user" && steering.run_id === message.run_id && !included.has(steering.id)) {
      history.push(toModelMessage(steering)); included.add(steering.id);
    }
  }
  return history;
}
