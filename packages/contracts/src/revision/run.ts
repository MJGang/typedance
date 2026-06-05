import { z } from "zod";
import { isoDateTimeSchema } from "../shared";

export const revisionRunTypeSchema = z.enum([
  "import_reconstruct",
  "blank_guided_generate",
  "quality_review",
  "issue_action",
  "module_rewrite",
  "evidence_check",
  "opportunity_calibrate",
  "review_gate",
]);

export const revisionRunStatusSchema = z.enum([
  "created",
  "parsing",
  "recognizing",
  "understanding",
  "planning",
  "generating",
  "verifying",
  "building_tasks",
  "awaiting_user_confirmation",
  "ready_for_review",
  "completed",
  "failed_retryable",
  "failed_final",
  "canceled",
  "stale",
]);

export const revisionRunSchema = z.object({
  id: z.string().min(1),
  document_id: z.string().min(1),
  pack_id: z.string().min(1),
  run_type: revisionRunTypeSchema,
  status: revisionRunStatusSchema,
  source_document_ids: z.array(z.string()).default([]),
  input_source_canvas_id: z.string().optional(),
  input_source_canvas_version: z.number().int().positive().optional(),
  base_draft_id: z.string().optional(),
  target_draft_id: z.string().optional(),
  user_intent: z.string().optional(),
  selected_module_id: z.string().optional(),
  selected_issue_id: z.string().optional(),
  selected_action_id: z.string().optional(),
  output_summary: z.string().optional(),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
});

export const agentStepSchema = z.object({
  id: z.string().min(1),
  run_id: z.string().min(1),
  agent_name: z.string().min(1),
  status: z.enum([
    "pending",
    "running",
    "completed",
    "failed_schema",
    "failed_tool",
    "failed_model",
    "failed_policy",
    "skipped",
  ]),
  input_refs: z.array(z.string()).default([]),
  output_refs: z.array(z.string()).default([]),
  error: z.record(z.unknown()).optional(),
  started_at: isoDateTimeSchema.optional(),
  finished_at: isoDateTimeSchema.optional(),
});

export type RevisionRunType = z.infer<typeof revisionRunTypeSchema>;
export type RevisionRunStatus = z.infer<typeof revisionRunStatusSchema>;
export type RevisionRun = z.infer<typeof revisionRunSchema>;
export type AgentStep = z.infer<typeof agentStepSchema>;
