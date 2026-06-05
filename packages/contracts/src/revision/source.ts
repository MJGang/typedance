import { z } from "zod";
import { isoDateTimeSchema } from "../shared";

export const sourceTypeSchema = z.enum([
  "old_resume",
  "uploaded_file",
  "pasted_text",
  "manual_user_input",
  "project_material",
  "work_summary",
  "external_context",
]);

export const sourceDocumentSchema = z.object({
  id: z.string().min(1),
  document_id: z.string().min(1),
  source_type: sourceTypeSchema,
  title: z.string().min(1),
  mime_type: z.string().optional(),
  original_uri: z.string().optional(),
  raw_text: z.string().optional(),
  file_path: z.string().optional(),
  parse_status: z.enum([
    "pending",
    "initialized",
    "recognizing",
    "recognized",
    "recognition_failed",
  ]),
  metadata: z.record(z.unknown()).default({}),
  created_at: isoDateTimeSchema,
});

export const parsedBlockSchema = z.object({
  id: z.string().min(1),
  source_document_id: z.string().min(1),
  type: z.enum(["heading", "paragraph", "list", "table", "contact", "date_range", "unknown"]),
  text: z.string(),
  order: z.number().int().nonnegative(),
  page: z.number().int().positive().optional(),
  source_span: z.record(z.unknown()).default({}),
});

export const sourceDocumentSummarySchema = sourceDocumentSchema.pick({
  id: true,
  document_id: true,
  source_type: true,
  title: true,
  parse_status: true,
  created_at: true,
});

export type SourceType = z.infer<typeof sourceTypeSchema>;
export type SourceDocument = z.infer<typeof sourceDocumentSchema>;
export type ParsedBlock = z.infer<typeof parsedBlockSchema>;
export type SourceDocumentSummary = z.infer<typeof sourceDocumentSummarySchema>;
