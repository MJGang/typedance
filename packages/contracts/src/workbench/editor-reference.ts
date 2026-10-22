import { z } from "zod";
import { canvasPrintSnapshotSchema } from "../revision/canvas-print";

export const editorReferenceSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("canvas"),
    editor_session_id: z.string().min(1),
    content_revision: z.number().int().nonnegative(),
    from: z.number().int().nonnegative(),
    to: z.number().int().positive(),
    canvas_node_id: z.string().min(1).optional(),
    slice_content: z.array(z.record(z.unknown())),
  }),
  z.object({ kind: z.literal("message"), message_id: z.string().min(1) }),
]).refine((value) => value.kind !== "canvas" || value.to > value.from, "Invalid reference range");

export const editorReferenceSchema = z.object({
  id: z.string().min(1),
  ordinal: z.number().int().positive(),
  document_id: z.string().min(1),
  label: z.string().min(1).max(160),
  text: z.string().min(1).max(4_000),
  comment: z.string().max(2_000),
  source: editorReferenceSourceSchema,
});

export const editorReferencesSchema = z.array(editorReferenceSchema).max(12);

export const editorSnapshotSchema = z.object({
  document_id: z.string().min(1),
  editor_session_id: z.string().min(1),
  content_revision: z.number().int().nonnegative(),
  canvas_version: z.number().int().positive(),
  doc_json: z.record(z.unknown()),
  plain_text: z.string().max(120_000),
  print_snapshot: canvasPrintSnapshotSchema.optional(),
});

export const textEditPreviewSchema = z.object({
  kind: z.literal("text_edit_preview"),
  id: z.string().min(1),
  document_id: z.string().min(1),
  reference_id: z.string().min(1),
  original_text: z.string().min(1),
  replacement: z.string().max(4_000),
  replacement_content: z.array(z.record(z.unknown())),
  summary: z.string().max(500),
  editor_session_id: z.string().min(1),
});

export type EditorReference = z.infer<typeof editorReferenceSchema>;
export type EditorSnapshot = z.infer<typeof editorSnapshotSchema>;
export type TextEditPreview = z.infer<typeof textEditPreviewSchema>;
