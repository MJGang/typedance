import { z } from "zod";
import { isoDateTimeSchema } from "../shared";

export const claimConfidenceSchema = z.enum([
  "supported",
  "user_confirmed",
  "inferred",
  "unsupported",
]);

export const claimTypeSchema = z.enum([
  "responsibility",
  "achievement",
  "skill",
  "summary",
  "education",
  "certificate",
  "intent",
  "custom",
]);

export const documentClaimSchema = z.object({
  id: z.string().min(1),
  draft_id: z.string().min(1),
  module_id: z.string().min(1),
  item_id: z.string().optional(),
  text: z.string().min(1),
  claim_type: claimTypeSchema.or(z.string().min(1)),
  confidence: claimConfidenceSchema,
  risk_flags: z.array(z.string()).default([]),
  source_span_refs: z.array(z.string()).default([]),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
});

export type ClaimConfidence = z.infer<typeof claimConfidenceSchema>;
export type ClaimType = z.infer<typeof claimTypeSchema>;
export type DocumentClaim = z.infer<typeof documentClaimSchema>;
