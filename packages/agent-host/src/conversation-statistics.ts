import { harnessRunEventSchema, type HarnessRunEvent } from "@typedance/harness-contracts";
import type { ConversationStatistics } from "@typedance/contracts";
import type { AgentHostStore } from "./store";
import { DEEPSEEK_MODELS } from "./model-catalog";

type Started = Extract<HarnessRunEvent, { type: "model.call.started" }>;
type Progress = Extract<HarnessRunEvent, { type: "model.call.progress" }>;
type Completed = Extract<HarnessRunEvent, { type: "model.call.completed" }>;
type Call = { started: Started; progress?: Progress; completed?: Completed };

/** 耗时和接收量按当前时刻更新；计费和 TPS 只使用服务端回报的完整用量。 */
export function conversationStatistics(store: AgentHostStore, conversationId: string, now = Date.now()): ConversationStatistics {
  const runs = store.listRuns(conversationId);
  const statistics: ConversationStatistics = {
    sampled_at: new Date(now).toISOString(), activity: { runs: 0, model_calls: 0, tool_calls: 0, output_characters: 0 },
    turns: runs.length, steps: 0, model_ms: 0, tool_ms: 0, ttft_ms: null, tokens_per_second: null,
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0, cache_read_tokens: 0, cache_miss_tokens: 0,
      cache_hit_percent: null, measured_calls: 0, unmeasured_calls: 0 },
    context: null,
  };
  let ttftMs = 0; let ttftCalls = 0; let decodeMs = 0; let decodeTokens = 0; let cacheInput = 0;
  let contextTime = -Infinity;
  for (const run of runs) {
    const terminal = run.status === "completed" || run.status === "failed" || run.status === "cancelled";
    if (!terminal) statistics.activity.runs += 1;
    const events = store.listRunEvents(run.id);
    const ended = terminal ? Date.parse(run.completed_at ?? events.at(-1)?.created_at ?? run.started_at) : now;
    const calls = new Map<string, Call>();
    const tools = new Map<string, number>();
    for (const event of events) {
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
      if (raw?.type !== "model.call.started" && raw?.type !== "model.call.progress" && raw?.type !== "model.call.completed") continue;
      const parsed = harnessRunEventSchema.safeParse(raw);
      if (!parsed.success) continue;
      const modelEvent = parsed.data as Started | Progress | Completed;
      if (modelEvent.type === "model.call.started") {
        if (!calls.has(modelEvent.call_id)) calls.set(modelEvent.call_id, { started: modelEvent });
      } else {
        const call = calls.get(modelEvent.call_id);
        if (!call || call.completed) continue;
        if (modelEvent.type === "model.call.progress") call.progress = modelEvent;
        else call.completed = modelEvent;
      }
    }
    for (const { started, progress, completed } of calls.values()) {
      statistics.steps += 1;
      const active = !terminal && !completed;
      if (active) statistics.activity.model_calls += 1;
      if (active) statistics.activity.output_characters += progress?.output_characters ?? 0;
      const duration = completed?.duration_ms ?? Math.max(0, ended - Date.parse(started.created_at));
      statistics.model_ms += duration;
      const ttft = completed?.ttft_ms ?? progress?.ttft_ms;
      if (ttft !== undefined) { ttftMs += ttft; ttftCalls += 1; }
      const usage = completed?.usage;
      const measured = usage?.inputTokens !== undefined && usage.outputTokens !== undefined;
      const input = usage?.inputTokens ?? started.input_tokens;
      const output = usage?.outputTokens ?? progress?.output_tokens ?? 0;
      if (measured) {
        statistics.usage.input_tokens += input;
        statistics.usage.output_tokens += output;
        // 缓存和 reasoning 是输入/输出的子集，不能重复计入总量。
        statistics.usage.total_tokens += usage?.totalTokens ?? input + output;
        statistics.usage.measured_calls += 1;
        if (usage.cacheReadInputTokens !== undefined) {
          cacheInput += input;
          const cached = Math.min(input, usage.cacheReadInputTokens);
          statistics.usage.cache_read_tokens += cached;
          statistics.usage.cache_miss_tokens += input - cached;
        }
      } else if (!active) statistics.usage.unmeasured_calls += 1;
      const decoding = ttft === undefined ? 0 : Math.max(0, duration - ttft);
      if (decoding > 0 && measured) {
        decodeMs += decoding; decodeTokens += output;
      }
      if (started.purpose === "response" && Date.parse(started.created_at) >= contextTime) {
        contextTime = Date.parse(started.created_at);
        statistics.context = contextReading(started, input, output, !measured, completed?.model);
      }
    }
    for (const started of tools.values()) statistics.tool_ms += Math.max(0, ended - started);
    if (!terminal) statistics.activity.tool_calls += tools.size;
  }
  statistics.ttft_ms = ttftCalls ? ttftMs / ttftCalls : null;
  statistics.tokens_per_second = decodeMs > 0 ? decodeTokens / (decodeMs / 1000) : null;
  statistics.usage.cache_hit_percent = cacheInput > 0 ? statistics.usage.cache_read_tokens / cacheInput * 100 : null;
  return statistics;
}

function contextReading(started: Started, input: number, output: number, estimated: boolean, completedModel?: string): NonNullable<ConversationStatistics["context"]> {
  const model = completedModel ?? started.model;
  const scale = started.input_tokens > 0 ? input / started.input_tokens : 1;
  const system = Math.round(started.system_tokens * scale);
  const tools = Math.round(started.tool_tokens * scale);
  return {
    model, input_tokens: input, output_tokens: output,
    limit_tokens: DEEPSEEK_MODELS.find((entry) => entry.id === model)?.context_window ?? null,
    budget_tokens: started.budget_tokens,
    system_tokens: system, tool_tokens: tools, conversation_tokens: Math.max(0, input - system - tools) + output,
    estimated,
  };
}
