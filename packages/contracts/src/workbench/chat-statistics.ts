import { z } from "zod";

export const reasoningEffortSchema = z.enum(["off", "low", "high", "max"]);
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;
export const agentModelOptionSchema = z.object({
  id: z.string().min(1), name: z.string().min(1),
  context_window: z.number().positive().nullable(),
  reasoning_efforts: z.array(reasoningEffortSchema),
});
export const modelSelectionSchema = z.object({
  model: z.string().min(1), reasoning_effort: reasoningEffortSchema.nullable(),
  models: z.array(agentModelOptionSchema),
});
export const modelSelectionUpdateSchema = z.object({
  model: z.string().trim().min(1), reasoning_effort: reasoningEffortSchema.nullable(),
}).strict();
export type ModelSelection = z.infer<typeof modelSelectionSchema>;

const count = z.number().nonnegative();
export const conversationStatisticsSchema = z.object({
  sampled_at: z.string().datetime(),
  activity: z.object({ runs: count, model_calls: count, tool_calls: count, output_characters: count }),
  turns: count, steps: count, model_ms: count, tool_ms: count,
  ttft_ms: count.nullable(), tokens_per_second: count.nullable(),
  usage: z.object({
    input_tokens: count, output_tokens: count, total_tokens: count,
    cache_read_tokens: count, cache_miss_tokens: count, cache_hit_percent: count.nullable(),
    measured_calls: count, unmeasured_calls: count,
  }),
  context: z.object({
    model: z.string().optional(), input_tokens: count, output_tokens: count,
    limit_tokens: count.nullable(), budget_tokens: count,
    system_tokens: count, tool_tokens: count, conversation_tokens: count,
    estimated: z.boolean(),
  }).nullable(),
});
export type ConversationStatistics = z.infer<typeof conversationStatisticsSchema>;
