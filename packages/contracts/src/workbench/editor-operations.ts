import { z } from "zod";
import { editorSnapshotSchema } from "./editor-reference";
import { templateStyleConfigSchema } from "../legacy/template-style";

// 参数语义和规则由 Sidecar 能力注册表定义；这里只定义跨进程传输边界。
export const editorOperationSchema = z.object({
  capability: z.string().min(1),
  parameters: z.record(z.unknown()),
}).strict();

export const editorCapabilityCatalogSchema = z.object({
  revision: z.string().min(1),
  scope: z.literal("current_document"),
  units: z.record(z.string()),
  template_schema: z.record(z.unknown()),
  operations: z.array(z.object({
    id: z.string(), title: z.string(), description: z.string(),
    effect: z.enum(["content", "format", "layout"]), parameters: z.record(z.unknown()),
  })),
});

export const editorNodeOriginSchema = z.object({
  before_path: z.array(z.number().int().nonnegative()).max(32),
  after_path: z.array(z.number().int().nonnegative()).max(32).nullable(),
}).strict();

// 原文片段的偏移按 UTF-16 计数；结构位置由前端编辑器 schema 换算。
export const editorTextOriginSchema = z.object({
  before_path: z.array(z.number().int().nonnegative()).max(32),
  spans: z.array(z.object({
    before_from: z.number().int().nonnegative(), before_to: z.number().int().positive(),
    after_path: z.array(z.number().int().nonnegative()).max(32), after_from: z.number().int().nonnegative(),
  }).strict()).max(10000),
}).strict();

export const editorTransactionSchema = z.object({
  id: z.string().min(1), document_id: z.string().min(1), editor_session_id: z.string().min(1),
  content_revision: z.number().int().nonnegative(),
  summary: z.string().min(1).max(1000),
  before_doc_json: z.record(z.unknown()), doc_json: z.record(z.unknown()),
  before_template_style: templateStyleConfigSchema.optional(),
  effects: z.array(z.object({ capability: z.string(), title: z.string(), effect: z.string() })),
  catalog_revision: z.string(),
  node_origins: z.array(editorNodeOriginSchema).max(10000),
  text_origins: z.array(editorTextOriginSchema).max(10000),
});

export const editorRequestSchema = z.object({
  id: z.string().min(1), document_id: z.string().min(1), editor_session_id: z.string().min(1),
  kind: z.enum(["snapshot", "transaction"]), mode: z.enum(["review", "solo"]),
  transaction: editorTransactionSchema.optional(),
});

export const editorResponseSchema = z.object({
  status: z.enum(["snapshot", "applied", "unchanged", "rejected", "failed"]),
  snapshot: editorSnapshotSchema.optional(),
  persisted: z.boolean().optional(),
  error: z.string().max(2000).optional(),
});

export type EditorOperation = z.infer<typeof editorOperationSchema>;
export type EditorNodeOrigin = z.infer<typeof editorNodeOriginSchema>;
export type EditorTextOrigin = z.infer<typeof editorTextOriginSchema>;
export type EditorCapabilityCatalog = z.infer<typeof editorCapabilityCatalogSchema>;
export type EditorTransaction = z.infer<typeof editorTransactionSchema>;
export type EditorRequest = z.infer<typeof editorRequestSchema>;
export type EditorResponse = z.infer<typeof editorResponseSchema>;
