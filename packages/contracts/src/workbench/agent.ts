import { z } from "zod";
import { isoDateTimeSchema } from "../shared";
import { editorReferencesSchema } from "./editor-reference";
import { harnessAttachmentsSchema } from "@typedance/harness-contracts";
export { harnessAttachmentSchema, harnessAttachmentsSchema, type HarnessAttachment } from "@typedance/harness-contracts";

export const canvasMutationModeSchema = z.enum(["suggest", "review", "solo"]);

export const contextSourceTypeSchema = z.enum(["file", "directory", "webpage"]);

export const contextSourceSchema = z.object({
  id: z.string().min(1),
  workspace_id: z.string().min(1),
  type: contextSourceTypeSchema,
  title: z.string().min(1),
  uri: z.string().min(1),
  description: z.string().optional(),
  summary: z.string().optional(),
  favicon_url: z.string().optional(),
  metadata: z.record(z.unknown()).default({}),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
});

export const contextSourceChildSchema = z.object({
  type: z.enum(["file", "directory"]),
  name: z.string().min(1),
  path: z.string(),
  uri: z.string().min(1),
  size: z.number().int().nonnegative().optional(),
  updated_at: isoDateTimeSchema.optional(),
});

export const contextMentionSchema = z.object({
  context_source_id: z.string().min(1),
  type: contextSourceTypeSchema,
  label: z.string().min(1),
  uri: z.string().min(1).optional(),
  target_path: z.string().optional(),
});

export const agentConversationStatusSchema = z.enum(["idle", "running", "failed"]);

export const agentConversationSchema = z.object({
  id: z.string().min(1),
  workspace_id: z.string().min(1),
  name: z.string().min(1).nullable(),
  preview: z.string().default(""),
  first_user_message: z.string().min(1).optional(),
  pinned: z.boolean().default(false),
  status: agentConversationStatusSchema.default("idle"),
  last_message_at: isoDateTimeSchema.optional(),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
});

export const agentMessageRoleSchema = z.enum(["user", "assistant", "system"]);

export const agentMessageSchema = z.object({
  id: z.string().min(1),
  conversation_id: z.string().min(1),
  role: agentMessageRoleSchema,
  content: z.string().default(""),
  mentions: z.array(contextMentionSchema).default([]),
  references: editorReferencesSchema.optional(),
  attachments: harnessAttachmentsSchema.optional(),
  run_id: z.string().min(1).optional(),
  created_at: isoDateTimeSchema,
});

export const agentRunStatusSchema = z.enum(["running", "completed", "failed", "cancelled"]);

export const agentRunSchema = z.object({
  id: z.string().min(1),
  conversation_id: z.string().min(1),
  assistant_message_id: z.string().min(1).optional(),
  status: agentRunStatusSchema,
  model: z.string().min(1).optional(),
  mutation_mode: canvasMutationModeSchema.default("review"),
  started_at: isoDateTimeSchema,
  completed_at: isoDateTimeSchema.optional(),
  duration_ms: z.number().int().nonnegative().optional(),
});

export const agentRunEventTypeSchema = z.enum([
  "thinking_delta",
  "assistant_delta",
  "tool_call_started",
  "tool_call_delta",
  "tool_call_completed",
  "tool_call_failed",
  "canvas_patch_proposed",
  "canvas_patch_applied",
  "text_edit_decision",
  "editor_request",
  "editor_response",
  "run_completed",
  "run_failed",
  "run_cancelled",
  "harness_event",
]);

export const agentRunEventSchema = z.object({
  id: z.string().min(1),
  run_id: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  type: agentRunEventTypeSchema,
  payload: z.record(z.unknown()).default({}),
  created_at: isoDateTimeSchema,
});

export const canvasChangedBlockSchema = z.object({
  block_id: z.string().min(1),
  label: z.string().min(1).optional(),
});

export const canvasPatchSchema = z.object({
  id: z.string().min(1),
  run_id: z.string().min(1),
  summary: z.string().min(1),
  changed_blocks: z.array(canvasChangedBlockSchema).default([]),
  diff: z.string().optional(),
  status: z.enum(["proposed", "applied", "ignored"]).default("proposed"),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
});

export const agentPluginSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  enabled: z.boolean().default(true),
});

export type CanvasMutationMode = z.infer<typeof canvasMutationModeSchema>;
export type ContextSourceType = z.infer<typeof contextSourceTypeSchema>;
export type ContextSource = z.infer<typeof contextSourceSchema>;
export type ContextSourceChild = z.infer<typeof contextSourceChildSchema>;
export type ContextMention = z.infer<typeof contextMentionSchema>;
export type AgentConversationStatus = z.infer<typeof agentConversationStatusSchema>;
export type AgentConversation = z.infer<typeof agentConversationSchema>;
export type AgentMessageRole = z.infer<typeof agentMessageRoleSchema>;
export type AgentMessage = z.infer<typeof agentMessageSchema>;
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;
export type AgentRun = z.infer<typeof agentRunSchema>;
export type AgentRunEventType = z.infer<typeof agentRunEventTypeSchema>;
export type AgentRunEvent = z.infer<typeof agentRunEventSchema>;
export type CanvasPatch = z.infer<typeof canvasPatchSchema>;
export type AgentPluginSummary = z.infer<typeof agentPluginSummarySchema>;
