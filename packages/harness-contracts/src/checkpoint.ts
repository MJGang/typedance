import { z } from "zod";
import { harnessContentPartSchema } from "./content";
import { harnessRunSchema } from "./run";
import { harnessToolCallSchema } from "./tool";

const modelContentSchema = z.union([z.string(), z.array(harnessContentPartSchema)]);
export const harnessModelMessageSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("system"), content: z.string() }),
  z.object({ role: z.literal("user"), content: modelContentSchema, internal: z.enum(["compaction", "completion"]).optional() }),
  z.object({ role: z.literal("assistant"), content: z.string(), toolCalls: z.array(harnessToolCallSchema).optional() }),
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
  last_input_tokens: z.number().nonnegative().optional(),
  last_input_estimate: z.number().nonnegative().optional(),
  compactions: z.number().int().nonnegative(),
  phase: z.enum(["ready", "model", "tools", "completed"]),
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
