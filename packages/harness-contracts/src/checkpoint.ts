import { z } from "zod";
import { harnessContentPartSchema } from "./content";
import { harnessRunSchema } from "./run";
import { harnessToolCallSchema } from "./tool";

const modelContentSchema = z.union([z.string(), z.array(harnessContentPartSchema)]);
export const harnessModelMessageSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("system"), content: z.string() }),
  z.object({ role: z.literal("user"), content: modelContentSchema, internal: z.enum(["compaction", "completion", "context"]).optional(), contextSource: z.string().min(1).optional() }),
  z.object({ role: z.literal("assistant"), content: z.string(), reasoningContent: z.string().optional(), toolCalls: z.array(harnessToolCallSchema).optional() }),
  z.object({ role: z.literal("tool"), content: modelContentSchema, toolCallId: z.string().min(1), toolName: z.string().min(1) }),
]);

export const harnessPromptSectionSchema = z.object({
  slot: z.enum(["developer", "contextual"]),
  source: z.string().min(1),
  content: z.string(),
  priority: z.number().optional(),
  budget: z.object({ maxChars: z.number(), originalChars: z.number(), truncated: z.boolean() }).optional(),
  provenance: z.object({ kind: z.string(), sourceId: z.string().optional(), path: z.string().optional(), metadata: z.record(z.string()).optional() }).optional(),
});
export const harnessPromptBundleSchema = z.object({
  developer: z.array(harnessPromptSectionSchema),
  contextual: z.array(harnessPromptSectionSchema),
  conversation: z.array(harnessModelMessageSchema),
});
export const harnessPlanItemSchema = z.object({
  id: z.string().min(1), title: z.string().min(1),
  status: z.enum(["pending", "in_progress", "completed", "failed", "skipped"]),
});
export const harnessPendingInputSchema = z.object({
  id: z.string().min(1), messages: z.array(harnessModelMessageSchema).min(1), contextual: z.array(harnessPromptSectionSchema),
});

/** 同一次已完成模型请求的输入测量；只有配置和已测前缀一致时可复用。 */
export const harnessInputMeasurementSchema = z.object({
  input_tokens: z.number().nonnegative(),
  estimated_tokens: z.number().nonnegative(),
  message_count: z.number().int().nonnegative(),
  prefix_hash: z.string().min(1),
  configuration_hash: z.string().min(1),
});

/** 模型容量、产品输入预算和输出/增长预留由宿主按本次运行提供。 */
export const harnessContextWindowSchema = z.object({
  maxInputTokens: z.number().int().positive().optional(),
  compactAtRatio: z.number().positive().lt(1).optional(),
  summaryTokens: z.number().int().positive().optional(),
  retainedUserTokens: z.number().int().positive().optional(),
  toolOutputTokens: z.number().int().positive().optional(),
  modelContextTokens: z.number().int().positive().optional(),
  reservedOutputTokens: z.number().int().nonnegative().optional(),
  growthHeadroomTokens: z.number().int().nonnegative().optional(),
});

/** 完整模型历史检查点；由宿主选择持久化方式，不由 Core 访问文件。 */
export const harnessCheckpointSchema = z.object({
  run: harnessRunSchema,
  agent_id: z.string().min(1),
  model: z.string().optional(),
  model_options: z.record(z.unknown()).optional(),
  objective: z.string().min(1),
  prompt: harnessPromptBundleSchema,
  plan: z.array(harnessPlanItemSchema),
  step: z.number().int().nonnegative(),
  tokens_used: z.number().nonnegative(),
  input_measurement: harnessInputMeasurementSchema.optional(),
  model_configuration_key: z.string().optional(),
  context_window: harnessContextWindowSchema.optional(),
  compactions: z.number().int().nonnegative(),
  phase: z.enum(["history", "ready", "model", "tools", "completed"]),
  pending_tool_calls: z.array(harnessToolCallSchema),
  in_flight_tool_call_id: z.string().optional(),
  pending_inputs: z.array(harnessPendingInputSchema),
  unconfirmed_input_ids: z.array(z.string()),
  input_ids: z.array(z.string()),
});

export type HarnessCheckpoint = z.infer<typeof harnessCheckpointSchema>;
export type HarnessPlanItem = z.infer<typeof harnessPlanItemSchema>;
export type HarnessPendingInput = z.infer<typeof harnessPendingInputSchema>;
export type HarnessModelMessage = z.infer<typeof harnessModelMessageSchema>;
export type HarnessPromptSection = z.infer<typeof harnessPromptSectionSchema>;
export type HarnessPromptBundle = z.infer<typeof harnessPromptBundleSchema>;
export type HarnessInputMeasurement = z.infer<typeof harnessInputMeasurementSchema>;
export type HarnessContextWindowOptions = z.infer<typeof harnessContextWindowSchema>;
