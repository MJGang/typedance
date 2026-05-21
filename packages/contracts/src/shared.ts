import { z } from "zod";

export const languageSchema = z.enum(["zh-CN", "en-US"]);

export const isoDateTimeSchema = z.string().datetime();

export const localizedTextSchema = z.object({
  "zh-CN": z.string().min(1),
  "en-US": z.string().min(1),
});

export const revisionTargetSchema = z.object({
  document_id: z.string().min(1).optional(),
  draft_id: z.string().min(1).optional(),
  module_id: z.string().min(1).optional(),
  claim_id: z.string().min(1).optional(),
  issue_id: z.string().min(1).optional(),
  proposal_id: z.string().min(1).optional(),
  source_document_id: z.string().min(1).optional(),
  parsed_block_id: z.string().min(1).optional(),
});

export type Language = z.infer<typeof languageSchema>;
export type LocalizedText = z.infer<typeof localizedTextSchema>;
export type RevisionTarget = z.infer<typeof revisionTargetSchema>;
