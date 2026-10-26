import { randomUUID } from "node:crypto";
import { editorCapabilityCatalogSchema, editorTransactionSchema, type EditorCapabilityCatalog, type EditorOperation, type EditorSnapshot, type EditorTransaction } from "@typedance/contracts";

export interface EditorService {
  catalog(signal: AbortSignal, operationIds?: string[]): Promise<EditorCapabilityCatalog>;
  inspect(snapshot: EditorSnapshot, signal: AbortSignal, options?: { offset?: number; limit?: number; text_limit?: number; view?: "outline" | "detail" | "layout"; paths?: number[][] }): Promise<Record<string, unknown>>;
  prepare(input: { snapshot: EditorSnapshot; operations: EditorOperation[]; catalogRevision: string; summary: string; signal: AbortSignal }): Promise<EditorTransaction>;
}

export function createSidecarEditorService(baseUrl: string, fetchImpl: typeof fetch = fetch): EditorService {
  const base = baseUrl.replace(/\/+$/, "");
  async function request(path: string, signal: AbortSignal, body?: unknown) {
    const response = await fetchImpl(`${base}${path}`, { signal, ...(body === undefined ? {} : {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }) });
    const data = await response.json();
    if (!response.ok) throw new Error(`编辑能力请求失败：${typeof data.detail === "string" ? data.detail : response.status}`);
    return data;
  }
  return {
    async catalog(signal, operationIds) {
      const query = new URLSearchParams();
      for (const id of operationIds ?? []) query.append("operation_ids", id);
      return editorCapabilityCatalogSchema.parse(await request(`/editor/capabilities${query.size ? `?${query}` : ""}`, signal));
    },
    async inspect(snapshot, signal, options) { return request("/editor/inspect", signal, { doc_json: snapshot.doc_json, template_style: snapshot.template_style, options }); },
    async prepare({ snapshot, operations, catalogRevision, summary, signal }) {
      const result = await request("/editor/prepare", signal,
        { doc_json: snapshot.doc_json, operations, catalog_revision: catalogRevision, template_style: snapshot.template_style });
      return editorTransactionSchema.parse({ ...result, id: randomUUID(), document_id: snapshot.document_id,
        editor_session_id: snapshot.editor_session_id, content_revision: snapshot.content_revision,
        before_doc_json: snapshot.doc_json, before_template_style: snapshot.template_style, summary });
    },
  };
}
