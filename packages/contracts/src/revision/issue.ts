import { z } from "zod";
import { isoDateTimeSchema, revisionTargetSchema } from "../shared";

export const resumeIssueTypeSchema = z.enum([
  "missing_info",
  "vague_expression",
  "missing_result",
  "missing_evidence",
  "timeline_conflict",
  "skill_without_support",
  "duplicate_content",
  "too_long",
  "tone_inconsistent",
  "hr_unfriendly",
  "overclaim_risk",
  "layout_risk",
]);

export const revisionActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  action_type: z.enum([
    "accept_proposal",
    "reject_proposal",
    "request_user_input",
    "make_more_conservative",
    "make_more_specific",
    "view_source",
    "dismiss_issue",
    "confirm_claim",
  ]),
  target: revisionTargetSchema.optional(),
});

export const revisionIssueSchema = z.object({
  id: z.string().min(1),
  run_id: z.string().min(1),
  document_id: z.string().min(1),
  draft_id: z.string().optional(),
  module_id: z.string().optional(),
  item_id: z.string().optional(),
  claim_id: z.string().optional(),
  type: resumeIssueTypeSchema.or(z.string().min(1)),
  severity: z.enum(["info", "warning", "blocking"]),
  title: z.string().min(1),
  message: z.string().min(1),
  reason: z.string().min(1),
  original_text: z.string().optional(),
  proposed_text: z.string().optional(),
  evidence_link_ids: z.array(z.string()).default([]),
  actions: z.array(revisionActionSchema).default([]),
  status: z.enum(["open", "resolved", "dismissed", "accepted", "needs_user_input"]),
  created_by_agent: z.string().min(1),
  created_at: isoDateTimeSchema,
});

export type ResumeIssueType = z.infer<typeof resumeIssueTypeSchema>;
export type RevisionAction = z.infer<typeof revisionActionSchema>;
export type RevisionIssue = z.infer<typeof revisionIssueSchema>;
