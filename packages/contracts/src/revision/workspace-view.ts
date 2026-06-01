import { z } from "zod";
import { revisionTargetSchema } from "../shared";
import { documentSchema } from "./document";
import { documentClaimSchema } from "./claim";
import { documentModuleSchema } from "./module";
import { draftVersionSchema } from "./draft";
import { evidenceLinkSchema } from "./evidence";
import { renderProjectionSchema } from "./render";
import { revisionActionSchema, revisionIssueSchema } from "./issue";
import { revisionProposalSchema } from "./proposal";
import { revisionRunStatusSchema } from "./run";
import { sourceResumeCanvasSchema } from "./source-canvas";
import { sourceDocumentSummarySchema } from "./source";

export const qualityGateResultSchema = z.object({
  status: z.enum(["unknown", "needs_review", "ready", "blocked"]),
  blocking_issue_ids: z.array(z.string()).default([]),
  warning_issue_ids: z.array(z.string()).default([]),
});

export const revisionRunStatusSummarySchema = z.object({
  run_id: z.string().min(1),
  status: revisionRunStatusSchema,
  current_step: z.string().optional(),
});

export const coachSummarySchema = z.object({
  summary: z.string(),
  next_action_ids: z.array(z.string()).default([]),
});

export const contextualActionSchema = revisionActionSchema.extend({
  target: revisionTargetSchema.optional(),
});

export const workspaceViewSchema = z.object({
  document: documentSchema,
  current_draft: draftVersionSchema.optional(),
  modules: z.array(documentModuleSchema).default([]),
  claims: z.array(documentClaimSchema).default([]),
  issues: z.array(revisionIssueSchema).default([]),
  proposals: z.array(revisionProposalSchema).default([]),
  evidence: z.array(evidenceLinkSchema).default([]),
  source_summaries: z.array(sourceDocumentSummarySchema).default([]),
  source_resume_canvas: sourceResumeCanvasSchema.optional(),
  render_projection: renderProjectionSchema.optional(),
  quality_gate: qualityGateResultSchema.optional(),
  run_status: revisionRunStatusSummarySchema.optional(),
  coach_summary: coachSummarySchema.optional(),
  available_actions: z.array(contextualActionSchema).default([]),
});

export type QualityGateResult = z.infer<typeof qualityGateResultSchema>;
export type RevisionRunStatusSummary = z.infer<typeof revisionRunStatusSummarySchema>;
export type CoachSummary = z.infer<typeof coachSummarySchema>;
export type ContextualAction = z.infer<typeof contextualActionSchema>;
export type WorkspaceView = z.infer<typeof workspaceViewSchema>;
