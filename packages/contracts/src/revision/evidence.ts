import { z } from "zod";
import { isoDateTimeSchema } from "../shared";

export const supportLevelSchema = z.enum([
  "direct",
  "partial",
  "inferred",
  "contradicted",
  "none",
]);

export const evidenceLinkSchema = z.object({
  id: z.string().min(1),
  document_id: z.string().min(1),
  source_document_id: z.string().min(1),
  claim_id: z.string().optional(),
  support_level: supportLevelSchema,
  extracted_text: z.string().optional(),
  normalized_fact: z.string().optional(),
  confidence: z.number().min(0).max(1),
  user_confirmed: z.boolean(),
  created_at: isoDateTimeSchema,
});

export const userConfirmationSchema = z.object({
  id: z.string().min(1),
  document_id: z.string().min(1),
  claim_id: z.string().optional(),
  evidence_link_id: z.string().optional(),
  issue_id: z.string().optional(),
  confirmation_type: z.enum(["truth_confirmed", "risk_accepted", "source_verified"]),
  note: z.string().optional(),
  created_at: isoDateTimeSchema,
});

export type SupportLevel = z.infer<typeof supportLevelSchema>;
export type EvidenceLink = z.infer<typeof evidenceLinkSchema>;
export type UserConfirmation = z.infer<typeof userConfirmationSchema>;
