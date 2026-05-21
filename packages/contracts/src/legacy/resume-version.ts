import { z } from "zod";
import { isoDateTimeSchema, languageSchema } from "../shared";

export const resumeVersionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  job_target_id: z.string().nullable().optional(),
  target_language: languageSchema,
  template_id: z.string().min(1),
  doc_json: z.record(z.unknown()),
  plain_text_snapshot: z.string(),
  preview_pdf_path: z.string().nullable().optional(),
  preview_pdf_url: z.string().nullable().optional(),
  source_refs: z.array(z.string()).default([]),
  accepted_edit_ids: z.array(z.string()).default([]),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
});

export const pdfExportSchema = z.object({
  id: z.string().min(1),
  resume_version_id: z.string().min(1),
  review_gate_result_id: z.string().nullable().optional(),
  file_path: z.string().min(1),
  language: languageSchema,
  layout_profile: z.enum(["single-page-a4", "multi-page-a4"]).default("single-page-a4"),
  layout_status: z.enum(["ready", "overflow", "render_failed"]),
  created_at: isoDateTimeSchema,
});

export type ResumeVersion = z.infer<typeof resumeVersionSchema>;
export type PDFExport = z.infer<typeof pdfExportSchema>;
