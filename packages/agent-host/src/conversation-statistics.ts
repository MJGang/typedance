import { harnessRunEventSchema, type HarnessRunEvent } from "@typedance/harness-contracts";
import type { ConversationStatistics } from "@typedance/contracts";
import type { AgentHostStore } from "./store";
import { DEEPSEEK_MODELS } from "./model-catalog";

type Started = Extract<HarnessRunEvent, { type: "model.call.started" }>;
type Completed = Extract<HarnessRunEvent, { type: "model.call.completed" }>;

/** 从完整持久化事件重建，刷新和上下文压缩不会重置累计用量。 */
export function conversationStatistics(store: AgentHostStore, conversationId: string): ConversationStatistics {
  const runs = store.listRuns(conversationId);
  const statistics: ConversationStatistics = {
    turns: runs.length, steps: 0, model_ms: 0, tool_ms: 0, ttft_ms: null, tokens_per_second: null,
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0, cache_read_tokens: 0, cache_miss_tokens: 0,
      cache_hit_percent: null, measured_calls: 0, unmeasured_calls: 0 },
    context: null,
  };
  let ttftMs = 0; let ttftCalls = 0; let decodeMs = 0; let decodeTokens = 0; let cacheInput = 0;
  let contextTime = -Infinity;
  for (const run of runs) {
    const calls = new Map<string, Started>();
    const finished = new Set<string>();
    const tools = new Map<string, number>();
    for (const event of store.listRunEvents(run.id)) {
      const timestamp = Date.parse(event.created_at);
      if (event.type === "tool_call_started") {
        const call = event.payload.tool_call as { id?: string } | undefined;
        if (call?.id) tools.set(call.id, timestamp);
      }
      if (event.type === "tool_call_completed" || event.type === "tool_call_failed") {
        const result = event.payload.result as { tool_call_id?: string } | undefined;
        const started = result?.tool_call_id ? tools.get(result.tool_call_id) : undefined;
        if (started !== undefined) {
          statistics.tool_ms += Math.max(0, timestamp - started);
          tools.delete(result!.tool_call_id!);
        }
      }
      if (event.type !== "harness_event") continue;
      const raw = event.payload.event as { type?: string } | undefined;
      if (raw?.type !== "model.call.started" && raw?.type !== "model.call.completed") continue;
      const parsed = harnessRunEventSchema.safeParse(raw);
      if (!parsed.success) continue;
      const modelEvent = parsed.data as Started | Completed;
      if (modelEvent.type === "model.call.started") {
        if (calls.has(modelEvent.call_id)) continue;
        calls.set(modelEvent.call_id, modelEvent);
        statistics.steps += 1;
        if (modelEvent.purpose === "response" && timestamp >= contextTime) {
          contextTime = timestamp;
          statistics.context = contextReading(modelEvent);
        }
        continue;
      }
      const started = calls.get(modelEvent.call_id);
      if (!started || finished.has(modelEvent.call_id)) continue;
      finished.add(modelEvent.call_id);
      statistics.model_ms += modelEvent.duration_ms;
      if (modelEvent.ttft_ms !== undefined) { ttftMs += modelEvent.ttft_ms; ttftCalls += 1; }
      const usage = modelEvent.usage;
      if (usage?.inputTokens !== undefined && usage.outputTokens !== undefined) {
        statistics.usage.measured_calls += 1;
        statistics.usage.input_tokens += usage.inputTokens;
        statistics.usage.output_tokens += usage.outputTokens;
        // 缓存和 reasoning 都是输入/输出的子集，不能重复计入总量。
        statistics.usage.total_tokens += usage.totalTokens ?? usage.inputTokens + usage.outputTokens;
        if (usage.cacheReadInputTokens !== undefined) {
          cacheInput += usage.inputTokens;
          const cached = Math.min(usage.inputTokens, usage.cacheReadInputTokens);
          statistics.usage.cache_read_tokens += cached;
          statistics.usage.cache_miss_tokens += usage.inputTokens - cached;
        }
        const decoding = modelEvent.ttft_ms === undefined ? 0 : modelEvent.duration_ms - modelEvent.ttft_ms;
        if (decoding > 0) { decodeMs += decoding; decodeTokens += usage.outputTokens; }
      } else statistics.usage.unmeasured_calls += 1;
      if (started.purpose === "response" && Date.parse(started.created_at) >= contextTime) {
        statistics.context = contextReading(started, modelEvent);
      }
    }
    if (run.completed_at) {
      const ended = Date.parse(run.completed_at);
      for (const [id, call] of calls) if (!finished.has(id)) {
        statistics.model_ms += Math.max(0, ended - Date.parse(call.created_at));
        statistics.usage.unmeasured_calls += 1;
      }
      for (const started of tools.values()) statistics.tool_ms += Math.max(0, ended - started);
    }
  }
  statistics.ttft_ms = ttftCalls ? ttftMs / ttftCalls : null;
  statistics.tokens_per_second = decodeMs > 0 ? decodeTokens / (decodeMs / 1000) : null;
  statistics.usage.cache_hit_percent = cacheInput > 0 ? statistics.usage.cache_read_tokens / cacheInput * 100 : null;
  return statistics;
}

function contextReading(started: Started, completed?: Completed): NonNullable<ConversationStatistics["context"]> {
  const model = completed?.model ?? started.model;
  const input = completed?.usage?.inputTokens ?? started.input_tokens;
  const output = completed?.usage?.outputTokens ?? 0;
  const scale = started.input_tokens > 0 ? input / started.input_tokens : 1;
  const system = Math.round(started.system_tokens * scale);
  const tools = Math.round(started.tool_tokens * scale);
  return {
    model, input_tokens: input, output_tokens: output,
    limit_tokens: DEEPSEEK_MODELS.find((entry) => entry.id === model)?.context_window ?? null,
    budget_tokens: started.budget_tokens,
    system_tokens: system, tool_tokens: tools, conversation_tokens: Math.max(0, input - system - tools) + output,
    estimated: completed?.usage?.inputTokens === undefined,
  };
}
