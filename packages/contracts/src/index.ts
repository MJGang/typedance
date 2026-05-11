import { z } from "zod";

export const languageSchema = z.enum(["zh-CN", "en-US"]);

export const resumeVersionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  job_target_id: z.string().nullable().optional(),
  target_language: languageSchema,
  template_id: z.string().min(1),
  doc_json: z.record(z.unknown()),
  plain_text_snapshot: z.string(),
  source_refs: z.array(z.string()).default([]),
  accepted_edit_ids: z.array(z.string()).default([]),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
});

export const pdfExportSchema = z.object({
  id: z.string().min(1),
  resume_version_id: z.string().min(1),
  review_gate_result_id: z.string().nullable().optional(),
  file_path: z.string().min(1),
  language: languageSchema,
  layout_profile: z.enum(["single-page-a4", "multi-page-a4"]).default("single-page-a4"),
  layout_status: z.enum(["ready", "overflow", "render_failed"]),
  created_at: z.string().datetime()
});

export const localizedTextSchema = z.object({
  "zh-CN": z.string().min(1),
  "en-US": z.string().min(1)
});

export const templateSampleContentSchema = z.object({
  id: z.string().min(1),
  name: localizedTextSchema,
  target_language: languageSchema,
  doc_json: z.record(z.unknown()),
  plain_text_snapshot: z.string(),
  updated_at: z.string().datetime()
});

export const templateStyleSlotSchema = z.object({
  label: localizedTextSchema,
  class_name: z.string().min(1),
  allowed_class_groups: z.array(z.string().min(1)).default([])
});

export const templateStyleConfigSchema = z.object({
  template_id: z.string().min(1),
  slots: z.record(templateStyleSlotSchema),
  updated_at: z.string().datetime()
});

export const pdfClassPolicyGroupSchema = z.object({
  label: localizedTextSchema,
  allowlist: z.array(z.string().min(1)),
  blocklist: z.array(z.string().min(1)).default([])
});

export const pdfClassPolicySchema = z.object({
  allowlist: z.array(z.string().min(1)),
  blocklist: z.array(z.string().min(1)).default([]),
  groups: z.record(pdfClassPolicyGroupSchema),
  updated_at: z.string().datetime()
});

export type ResumeVersion = z.infer<typeof resumeVersionSchema>;
export type PDFExport = z.infer<typeof pdfExportSchema>;
export type TemplateSampleContent = z.infer<typeof templateSampleContentSchema>;
export type TemplateStyleConfig = z.infer<typeof templateStyleConfigSchema>;
export type PdfClassPolicy = z.infer<typeof pdfClassPolicySchema>;
