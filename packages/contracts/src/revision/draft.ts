import { z } from "zod";
import { isoDateTimeSchema } from "../shared";

export const draftVersionStatusSchema = z.enum(["generated", "in_review", "accepted", "exported"]);

export const draftVersionSchema = z.object({
  id: z.string().min(1),
  document_id: z.string().min(1),
  run_id: z.string().min(1),
  pack_id: z.string().min(1),
  status: draftVersionStatusSchema,
  summary: z.string(),
  applied_proposal_ids: z.array(z.string()).default([]),
  unresolved_issue_ids: z.array(z.string()).default([]),
  render_projection_id: z.string().optional(),
  variant_type: z.enum(["base", "opportunity"]).default("base"),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
});

export type DraftVersionStatus = z.infer<typeof draftVersionStatusSchema>;
export type DraftVersion = z.infer<typeof draftVersionSchema>;
