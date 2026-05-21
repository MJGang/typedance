import { z } from "zod";
import { isoDateTimeSchema, revisionTargetSchema } from "../shared";

export const revisionOperationSchema = z.enum([
  "replace_claim",
  "insert_claim",
  "remove_claim",
  "rewrite_module",
  "reorder_module",
  "hide_module",
  "update_field",
]);

export const revisionProposalSchema = z.object({
  id: z.string().min(1),
  run_id: z.string().min(1),
  document_id: z.string().min(1),
  draft_id: z.string().optional(),
  target: revisionTargetSchema,
  operation: revisionOperationSchema,
  original_snapshot: z.unknown().optional(),
  proposed_snapshot: z.unknown(),
  summary: z.string().min(1),
  rationale: z.string().min(1),
  related_issue_ids: z.array(z.string()).default([]),
  evidence_link_ids: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  risk_level: z.enum(["low", "medium", "high"]),
  requires_user_confirmation: z.boolean(),
  status: z.enum(["pending", "applied", "rejected", "edited", "superseded"]),
  created_by_agent: z.string().min(1),
  created_at: isoDateTimeSchema,
});

export type RevisionOperation = z.infer<typeof revisionOperationSchema>;
export type RevisionProposal = z.infer<typeof revisionProposalSchema>;
