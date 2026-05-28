import { z } from "zod";
import { isoDateTimeSchema } from "../shared";

export const sourceResumeCanvasNodeTypeSchema = z.enum([
  "heading",
  "paragraph",
  "list_item",
  "table_cell",
  "unknown",
]);

export const sourceResumeCanvasNodeSchema = z.object({
  canvas_node_id: z.string().min(1),
  source_block_id: z.string().min(1).optional(),
  node_type: sourceResumeCanvasNodeTypeSchema,
  text: z.string(),
  source_span: z.record(z.unknown()).default({}),
  module_id: z.string().optional(),
});

export const moduleAnchorSchema = z.object({
  module_id: z.string().min(1),
  canvas_node_ids: z.array(z.string().min(1)).default([]),
  title: z.string().min(1),
  order: z.number().int().nonnegative(),
});

export const sourceResumeCanvasSchema = z.object({
  id: z.string().min(1),
  document_id: z.string().min(1),
  old_resume_source_id: z.string().min(1),
  doc_json: z.record(z.unknown()),
  node_map: z.array(sourceResumeCanvasNodeSchema).default([]),
  module_anchors: z.array(moduleAnchorSchema).default([]),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
});

export type SourceResumeCanvasNodeType = z.infer<typeof sourceResumeCanvasNodeTypeSchema>;
export type SourceResumeCanvasNode = z.infer<typeof sourceResumeCanvasNodeSchema>;
export type ModuleAnchor = z.infer<typeof moduleAnchorSchema>;
export type SourceResumeCanvas = z.infer<typeof sourceResumeCanvasSchema>;
