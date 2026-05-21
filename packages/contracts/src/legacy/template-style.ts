import { z } from "zod";
import { isoDateTimeSchema, languageSchema, localizedTextSchema } from "../shared";

export const templateSampleContentSchema = z.object({
  id: z.string().min(1),
  name: localizedTextSchema,
  target_language: languageSchema,
  doc_json: z.record(z.unknown()),
  plain_text_snapshot: z.string(),
  updated_at: isoDateTimeSchema,
});

export const blockTypeSchema = z.enum([
  "heading1",
  "heading2",
  "heading3",
  "paragraph",
  "bulletList",
  "orderedList",
]);

export const borderBottomSchema = z.object({
  style: z.enum(["none", "solid", "double"]).default("none"),
  width: z.string().optional(),
  color: z.string().optional(),
});

export const blockStyleSchema = z.object({
  fontFamily: z.string().optional(),
  fontSize: z.string().optional(),
  fontWeight: z.union([z.literal(400), z.literal(500), z.literal(600), z.literal(700)]).optional(),
  lineHeight: z.number().positive().optional(),
  letterSpacing: z.string().optional(),
  textTransform: z.enum(["none", "uppercase", "capitalize"]).optional(),
  color: z.string().optional(),
  backgroundColor: z.string().optional(),
  textAlign: z.enum(["left", "center", "right"]).optional(),
  marginTop: z.string().optional(),
  marginBottom: z.string().optional(),
  borderBottom: borderBottomSchema.optional(),
  listStyleType: z.enum(["disc", "circle", "square", "decimal", "none"]).optional(),
  paddingLeft: z.string().optional(),
});

export const templateStyleConfigSchema = z.object({
  template_id: z.string().min(1),
  name: z.string().optional(),
  preset: z.string().default("classic"),
  blocks: z.record(blockTypeSchema, blockStyleSchema),
  updated_at: isoDateTimeSchema,
});

export type TemplateSampleContent = z.infer<typeof templateSampleContentSchema>;
export type TemplateStyleConfig = z.infer<typeof templateStyleConfigSchema>;
export type BlockStyle = z.infer<typeof blockStyleSchema>;
export type BlockType = z.infer<typeof blockTypeSchema>;
