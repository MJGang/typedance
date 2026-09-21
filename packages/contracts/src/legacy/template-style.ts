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

export const heading2DecorationStyleSchema = z.enum([
  "minimal-line",
  "accent-wash",
  "dot-ribbon",
]);

export const themeStyleSchema = z.object({
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
}).strict();

export const heading2BlockStyleSchema = blockStyleSchema
  .omit({ backgroundColor: true, borderBottom: true })
  .extend({ decorationStyle: heading2DecorationStyleSchema })
  .strict();

export const templateBlocksSchema = z.object({
  heading1: blockStyleSchema,
  heading2: heading2BlockStyleSchema,
  heading3: blockStyleSchema,
  paragraph: blockStyleSchema,
  bulletList: blockStyleSchema,
  orderedList: blockStyleSchema,
}).strict();

export const templateStyleConfigSchema = z.object({
  template_id: z.string().min(1),
  name: z.string().optional(),
  preset: z.string(),
  theme: themeStyleSchema,
  blocks: templateBlocksSchema,
  updated_at: isoDateTimeSchema,
}).strict();

export type TemplateSampleContent = z.infer<typeof templateSampleContentSchema>;
export type TemplateStyleConfig = z.infer<typeof templateStyleConfigSchema>;
export type BlockStyle = z.infer<typeof blockStyleSchema>;
export type Heading2DecorationStyle = z.infer<typeof heading2DecorationStyleSchema>;
export type ThemeStyle = z.infer<typeof themeStyleSchema>;
export type Heading2BlockStyle = z.infer<typeof heading2BlockStyleSchema>;
export type BlockType = z.infer<typeof blockTypeSchema>;
