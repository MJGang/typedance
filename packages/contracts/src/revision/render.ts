import { z } from "zod";
import { isoDateTimeSchema } from "../shared";

export const layoutWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  severity: z.enum(["info", "warning", "blocking"]),
  target_module_id: z.string().optional(),
});

export const renderProjectionSchema = z.object({
  id: z.string().min(1),
  draft_id: z.string().min(1),
  render_profile: z.string().min(1),
  html: z.string().optional(),
  doc_json: z.unknown().optional(),
  layout_warnings: z.array(layoutWarningSchema).default([]),
  created_at: isoDateTimeSchema,
});

export const exportArtifactSchema = z.object({
  id: z.string().min(1),
  document_id: z.string().min(1),
  draft_id: z.string().min(1).nullish(),
  format: z.enum(["pdf", "html", "markdown", "docx"]),
  file_path: z.string().optional(),
  status: z.enum(["succeeded"]),
  created_at: isoDateTimeSchema,
});

export type LayoutWarning = z.infer<typeof layoutWarningSchema>;
export type RenderProjection = z.infer<typeof renderProjectionSchema>;
export type ExportArtifact = z.infer<typeof exportArtifactSchema>;
