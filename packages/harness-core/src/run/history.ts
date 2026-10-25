import type { HarnessCheckpoint, HarnessModelMessage } from "@typedance/harness-contracts";

/** Restore model evidence, never replay an interrupted invocation. */
export function restoreCheckpointHistory(checkpoint: HarnessCheckpoint): {
  messages: HarnessModelMessage[];
  inputIds: string[];
} {
  const messages = structuredClone(checkpoint.prompt.conversation);
  const results = new Set(messages.filter((message) => message.role === "tool").map((message) => message.toolCallId));
  for (const call of checkpoint.pending_tool_calls) {
    if (results.has(call.id)) continue;
    messages.push({ role: "tool", toolCallId: call.id, toolName: call.name, content: call.id === checkpoint.in_flight_tool_call_id
      ? "Execution was interrupted; this tool may have taken effect. Inspect authoritative state before deciding what to do. Do not blindly repeat it."
      : "This tool was not started before interruption. Reconsider it using current instructions and state." });
  }
  for (const pending of checkpoint.pending_inputs) messages.push(...pending.messages);
  return { messages, inputIds: [...new Set([...checkpoint.input_ids, ...checkpoint.pending_inputs.map((pending) => pending.id)])] };
}
