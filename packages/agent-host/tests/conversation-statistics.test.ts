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
  const start = (call: string, seconds = 0, purpose = "response", overrides: Record<string, unknown> = {}) => emit("model.call.started", {
    call_id: call, model: "deepseek-flash", purpose, input_tokens: 100, budget_tokens: 64_000,
    system_tokens: 20, tool_tokens: 30, conversation_tokens: 50, ...overrides,
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
    expect(conversationStatistics(store, conversation.id, Date.parse(result.sampled_at))).toEqual(result);
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

  it("anchors new requests to reported input instead of re-estimating the entire history", () => {
    const { store, conversation, run, start, emit } = fixture();
    store.updateRun(run.id, { status: "running", completed_at: undefined });
    start("first", 0, "response", { input_tokens: 45_000 });
    emit("model.call.progress", { call_id: "first", ttft_ms: 100, output_tokens: 800, output_characters: 400 }, 1);
    emit("model.call.completed", { call_id: "first", duration_ms: 1000, status: "completed",
      usage: { inputTokens: 29_000, outputTokens: 400 } }, 1);
    start("next", 2, "response", { input_tokens: 45_600 });
    emit("model.call.progress", { call_id: "next", ttft_ms: 100, output_tokens: 300, output_characters: 150 }, 3);
    const result = conversationStatistics(store, conversation.id);
    expect(result).toMatchObject({ usage: { total_tokens: 29_400 },
      context: { input_tokens: 29_387, output_tokens: 150, estimated: true } });
    expect(conversationStatistics(createMemoryAgentHostStore(store.snapshot()), conversation.id).context).toEqual(result.context);
    emit("model.call.completed", { call_id: "next", duration_ms: 2000, status: "completed",
      usage: { inputTokens: 29_620, outputTokens: 160 } }, 4);
    expect(conversationStatistics(store, conversation.id)).toMatchObject({ usage: { total_tokens: 59_180 },
      context: { input_tokens: 29_620, output_tokens: 160, estimated: false } });
  });

  it("retains the last measured baseline through calls with missing usage and signed input changes", () => {
    const { store, conversation, start, emit } = fixture();
    start("measured", 0, "response", { input_tokens: 3000 });
    emit("model.call.completed", { call_id: "measured", duration_ms: 1000, status: "completed",
      usage: { inputTokens: 1500, outputTokens: 20 } }, 1);
    start("missing", 2, "response", { input_tokens: 3300 });
    emit("model.call.completed", { call_id: "missing", duration_ms: 1000, status: "failed" }, 3);
    start("smaller", 4, "response", { input_tokens: 500 });
    expect(conversationStatistics(store, conversation.id)).toMatchObject({ usage: { total_tokens: 1520 },
      context: { input_tokens: 250, estimated: true } });
  });

  it("starts a fresh estimate after compaction and does not calibrate against compaction billing", () => {
    const { store, conversation, start, emit } = fixture();
    start("large", 0, "response", { input_tokens: 50_000 });
    emit("model.call.completed", { call_id: "large", duration_ms: 1000, status: "completed",
      usage: { inputTokens: 30_000, outputTokens: 100 } }, 1);
    start("compact", 2, "compaction", { input_tokens: 51_000 });
    emit("model.call.completed", { call_id: "compact", duration_ms: 1000, status: "completed",
      usage: { inputTokens: 31_000, outputTokens: 1000 } }, 3);
    emit("context.compacted", { before_tokens: 51_000, after_tokens: 4000, compaction: 1 }, 4);
    start("short", 5, "response", { input_tokens: 4000 });
    expect(conversationStatistics(store, conversation.id)).toMatchObject({ usage: { total_tokens: 62_100 },
      context: { input_tokens: 4000, output_tokens: 0, estimated: true } });
  });

  it("reuses calibration across turns but resets it when the model changes", () => {
    const { store, conversation, start, emit } = fixture();
    start("previous", 0, "response", { input_tokens: 3000 });
    emit("model.call.completed", { call_id: "previous", duration_ms: 1000, status: "completed",
      usage: { inputTokens: 1500, outputTokens: 20 } }, 1);
    const run = store.createRun({ run: { conversation_id: conversation.id, status: "running", mutation_mode: "review",
      started_at: "2026-10-24T00:00:20Z" } });
    const next = (model: string, callId: string, sequence: number) => {
      const timestamp = `2026-10-24T00:00:${20 + sequence}Z`;
      store.appendRunEvent({ runId: run.id, type: "harness_event", timestamp, payload: { event: {
        id: callId, run_id: run.id, sequence, created_at: timestamp, type: "model.call.started", call_id: callId,
        model, purpose: "response", input_tokens: 3500, budget_tokens: 64_000, system_tokens: 20, tool_tokens: 30, conversation_tokens: 3450,
      } } });
    };
    next("deepseek-flash", "same", 0);
    expect(conversationStatistics(store, conversation.id).context).toMatchObject({ input_tokens: 1750, estimated: true });
    next("deepseek-pro", "different", 1);
    expect(conversationStatistics(store, conversation.id).context).toMatchObject({ model: "deepseek-pro", input_tokens: 3500, estimated: true });
  });

  it("updates elapsed time, receipts and TTFT during a call and uses reported tokens for TPS", () => {
    const { store, conversation, run, start, emit } = fixture();
    store.updateRun(run.id, { status: "running", completed_at: undefined });
    start("a");
    const sample = (seconds: number) => conversationStatistics(store, conversation.id, Date.UTC(2026, 9, 24, 0, 0, seconds));
    expect(sample(2)).toMatchObject({ model_ms: 2000, tokens_per_second: null, activity: { runs: 1, model_calls: 1 }, usage: { total_tokens: 0 } });
    emit("model.call.progress", { call_id: "a", ttft_ms: 1000, output_tokens: 40, output_characters: 20 }, 3);
    expect(sample(3)).toMatchObject({ model_ms: 3000, ttft_ms: 1000, tokens_per_second: null,
      activity: { output_characters: 20 }, usage: { total_tokens: 0, output_tokens: 0 }, context: { output_tokens: 40, estimated: true } });
    expect(sample(5)).toMatchObject({ model_ms: 5000, tokens_per_second: null });
    emit("model.call.progress", { call_id: "a", ttft_ms: 1000, output_tokens: 80, output_characters: 40 }, 5);
    expect(sample(5)).toMatchObject({ tokens_per_second: null, activity: { output_characters: 40 }, usage: { total_tokens: 0 }, context: { output_tokens: 80 } });
    emit("model.call.completed", { call_id: "a", duration_ms: 6000, ttft_ms: 1000, status: "completed",
      usage: { inputTokens: 120, outputTokens: 100, cacheReadInputTokens: 60 } }, 6);
    expect(sample(7)).toMatchObject({ model_ms: 6000, tokens_per_second: 20,
      activity: { model_calls: 0 }, usage: { total_tokens: 220, output_tokens: 100, cache_hit_percent: 50 }, context: { estimated: false } });
    start("next", 8);
    expect(sample(9)).toMatchObject({ steps: 2, model_ms: 7000, tokens_per_second: 20, context: { output_tokens: 0, estimated: true } });
  });

  it("updates active tools, freezes failed runs and preserves received estimates across reloads", () => {
    const { store, conversation, run, start, emit } = fixture();
    store.updateRun(run.id, { status: "running", completed_at: undefined });
    start("a");
    emit("model.call.progress", { call_id: "a", ttft_ms: 1000, output_tokens: 20, output_characters: 10 }, 2);
    emit("model.call.completed", { call_id: "a", duration_ms: 3000, ttft_ms: 1000, status: "failed" }, 3);
    store.appendRunEvent({ runId: run.id, type: "tool_call_started", timestamp: "2026-10-24T00:00:03Z", payload: { tool_call: { id: "t" } } });
    expect(conversationStatistics(store, conversation.id, Date.UTC(2026, 9, 24, 0, 0, 7))).toMatchObject({ tool_ms: 4000, activity: { tool_calls: 1 } });
    store.updateRun(run.id, { status: "failed", completed_at: "2026-10-24T00:00:10Z" });
    const result = conversationStatistics(store, conversation.id, Date.UTC(2026, 9, 24, 0, 1));
    expect(result).toMatchObject({ model_ms: 3000, tool_ms: 7000, activity: { runs: 0, model_calls: 0, tool_calls: 0 },
      usage: { total_tokens: 0, unmeasured_calls: 1 } });
    const restored = createMemoryAgentHostStore(store.snapshot());
    expect(conversationStatistics(restored, conversation.id, Date.parse(result.sampled_at))).toEqual(result);
  });
});
