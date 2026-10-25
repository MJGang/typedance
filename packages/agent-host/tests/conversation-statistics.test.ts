import { describe, expect, it } from "vitest";
import { createMemoryAgentHostStore } from "../src/store";
import { conversationStatistics } from "../src/conversation-statistics";

function fixture() {
  const store = createMemoryAgentHostStore();
  const conversation = store.createConversation({ workspaceId: "doc", timestamp: "2026-10-24T00:00:00Z" });
  const run = store.createRun({ run: { conversation_id: conversation.id, status: "completed", mutation_mode: "review",
    started_at: "2026-10-24T00:00:00Z", completed_at: "2026-10-24T00:00:10Z" } });
  let sequence = 0;
  const emit = (type: string, data: Record<string, unknown>, seconds: number) => {
    const timestamp = new Date(Date.UTC(2026, 9, 24, 0, 0, seconds)).toISOString();
    store.appendRunEvent({ runId: run.id, type: "harness_event", timestamp,
      payload: { event: { id: `event_${sequence}`, run_id: run.id, sequence: sequence++, created_at: timestamp, type, ...data } } });
  };
  const start = (call: string, seconds = 0, purpose = "response") => emit("model.call.started", {
    call_id: call, model: "deepseek-flash", purpose, input_tokens: 100, budget_tokens: 64_000,
    system_tokens: 20, tool_tokens: 30, conversation_tokens: 50,
  }, seconds);
  return { store, conversation, run, emit, start };
}

describe("conversation statistics", () => {
  it("counts inclusive provider totals once and weights throughput by decode duration", () => {
    const { store, conversation, start, emit } = fixture();
    start("a");
    emit("model.call.completed", { call_id: "a", duration_ms: 3000, ttft_ms: 1000, status: "completed",
      usage: { inputTokens: 200, outputTokens: 100, totalTokens: 300, cacheReadInputTokens: 180, reasoningOutputTokens: 50 } }, 3);
    start("b", 4);
    emit("model.call.completed", { call_id: "b", duration_ms: 6000, ttft_ms: 2000, status: "completed",
      usage: { inputTokens: 100, outputTokens: 200, cacheReadInputTokens: 60 } }, 10);
    const result = conversationStatistics(store, conversation.id);
    expect(result).toMatchObject({ turns: 1, steps: 2, model_ms: 9000, ttft_ms: 1500, tokens_per_second: 50,
      usage: { input_tokens: 300, output_tokens: 300, total_tokens: 600, cache_read_tokens: 240, cache_miss_tokens: 60,
        cache_hit_percent: 80, measured_calls: 2, unmeasured_calls: 0 },
      context: { input_tokens: 100, output_tokens: 200, limit_tokens: 1_000_000, system_tokens: 20, tool_tokens: 30, conversation_tokens: 250, estimated: false } });
    expect(conversationStatistics(store, conversation.id)).toEqual(result);
  });

  it("keeps missing usage unknown, closes interrupted timings, and isolates other conversations", () => {
    const { store, conversation, run, start } = fixture();
    start("interrupted");
    store.appendRunEvent({ runId: run.id, type: "tool_call_started", timestamp: "2026-10-24T00:00:02Z", payload: { tool_call: { id: "constructor" } } });
    expect(conversationStatistics(store, conversation.id)).toMatchObject({ model_ms: 10_000, tool_ms: 8_000,
      ttft_ms: null, tokens_per_second: null, usage: { measured_calls: 0, unmeasured_calls: 1, cache_hit_percent: null }, context: { estimated: true } });
    expect(conversationStatistics(store, "other")).toMatchObject({ turns: 0, steps: 0, context: null, usage: { total_tokens: 0 } });
  });

  it("includes compaction billing without replacing the latest conversation context", () => {
    const { store, conversation, start, emit } = fixture();
    start("response");
    emit("model.call.completed", { call_id: "response", duration_ms: 1000, status: "completed", usage: { inputTokens: 100, outputTokens: 10 } }, 1);
    start("compact", 2, "compaction");
    emit("model.call.completed", { call_id: "compact", duration_ms: 1000, status: "completed", usage: { inputTokens: 900, outputTokens: 90 } }, 3);
    expect(conversationStatistics(store, conversation.id)).toMatchObject({ steps: 2, usage: { total_tokens: 1100, cache_hit_percent: null }, context: { input_tokens: 100, output_tokens: 10 } });
  });
});
