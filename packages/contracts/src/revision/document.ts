import { z } from "zod";
import { isoDateTimeSchema, languageSchema } from "../shared";

export const documentStatusSchema = z.enum(["active", "archived"]);

export const documentSchema = z.object({
  id: z.string().min(1),
  pack_id: z.string().min(1),
  title: z.string().min(1),
  template_id: z.string().min(1),
  status: documentStatusSchema,
  target_language: languageSchema,
  current_draft_id: z.string().nullable().optional(),
  accepted_draft_id: z.string().nullable().optional(),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
});

export const documentListItemSchema = documentSchema.pick({
  id: true,
  pack_id: true,
  title: true,
  status: true,
  target_language: true,
  current_draft_id: true,
  updated_at: true,
}).extend({
  quality_state: z.enum(["unknown", "needs_review", "ready", "blocked"]).optional(),
});

export type DocumentStatus = z.infer<typeof documentStatusSchema>;
export type Document = z.infer<typeof documentSchema>;
export type DocumentListItem = z.infer<typeof documentListItemSchema>;
