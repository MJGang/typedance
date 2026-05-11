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
  preview_pdf_path: z.string().nullable().optional(),
  preview_pdf_url: z.string().nullable().optional(),
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

export const blockTypeSchema = z.enum([
  "heading1", "heading2", "heading3",
  "paragraph", "bulletList", "orderedList",
]);

export const borderBottomSchema = z.object({
  style: z.enum(["none", "solid", "double"]).default("none"),
  width: z.string().optional(),
  color: z.string().optional(),
});

export const blockStyleSchema = z.object({
  // 排版
  fontFamily: z.string().optional(),
  fontSize: z.string().optional(),
  fontWeight: z.union([z.literal(400), z.literal(500), z.literal(600), z.literal(700)]).optional(),
  lineHeight: z.number().positive().optional(),
  letterSpacing: z.string().optional(),
  textTransform: z.enum(["none", "uppercase", "capitalize"]).optional(),

  // 颜色
  color: z.string().optional(),
  backgroundColor: z.string().optional(),

  // 对齐
  textAlign: z.enum(["left", "center", "right"]).optional(),

  // 间距
  marginTop: z.string().optional(),
  marginBottom: z.string().optional(),

  // 边框
  borderBottom: borderBottomSchema.optional(),

  // 列表专属
  listStyleType: z.enum(["disc", "circle", "square", "decimal", "none"]).optional(),
  paddingLeft: z.string().optional(),
});

export const templateStyleConfigSchema = z.object({
  template_id: z.string().min(1),
  preset: z.string().default("classic"),
  blocks: z.record(blockTypeSchema, blockStyleSchema),
  updated_at: z.string().datetime(),
});

export type ResumeVersion = z.infer<typeof resumeVersionSchema>;
export type PDFExport = z.infer<typeof pdfExportSchema>;
export type TemplateSampleContent = z.infer<typeof templateSampleContentSchema>;
export type TemplateStyleConfig = z.infer<typeof templateStyleConfigSchema>;
export type BlockStyle = z.infer<typeof blockStyleSchema>;
export type BlockType = z.infer<typeof blockTypeSchema>;
