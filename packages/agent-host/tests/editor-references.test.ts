import { describe, expect, it, vi } from "vitest";
import { createHarnessRuntime, type HarnessModelRequest } from "@typedance/harness-core";
import type { EditorReference, EditorSnapshot } from "@typedance/contracts";
import { createAgentHost, createSqliteAgentHostStore } from "../src";
import { createResumePluginLoader, registerResumeWorkbenchPlugin } from "../src/resume-plugin";
import { createSidecarContextProvider } from "../src/sidecar-context";
import { createSidecarEditorService } from "../src/editor-service";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const snapshot: EditorSnapshot = {
  document_id: "doc_1", editor_session_id: "editor_1", content_revision: 2, canvas_version: 1,
  doc_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "刚输入但尚未保存的经历" }] }] },
  plain_text: "刚输入但尚未保存的经历",
};
const reference: EditorReference = {
  id: "ref_1", ordinal: 1, document_id: "doc_1", text: snapshot.plain_text, comment: "精简，但不增加新事实", label: "工作经历 · 第 1 段",
  source: { kind: "canvas", editor_session_id: "editor_1", content_revision: 2, from: 1, to: 12, slice_content: [] },
};

describe("editor references", () => {
  it("uses unsaved editor content and keeps each reference instruction in persisted messages", async () => {
    const requests: HarnessModelRequest[] = [];
    const loader = createResumePluginLoader();
    const runtime = createHarnessRuntime({ skillContentLoader: loader.createSkillContentLoader(), model: {
      stream: async function* (request) {
        requests.push(request);
        yield { type: "assistant_delta", messageId: "answer", delta: "已读取当前画布和每处引用的要求。" };
        yield { type: "final", output: {} };
      },
    } });
    await registerResumeWorkbenchPlugin(runtime, loader);
    const directory = mkdtempSync(join(tmpdir(), "typedance-reference-test-"));
    let store: ReturnType<typeof createSqliteAgentHostStore> | undefined;
    try {
      const file = join(directory, "store.sqlite");
      const contextFetch = vi.fn<typeof fetch>();
      store = createSqliteAgentHostStore(file);
      const host = createAgentHost({ runtime, packs: [{ id: "resume", capabilityPolicy: { scopeIds: ["pack:resume"] }, primaryAgentId: "resume.primary" }],
        store, contextProvider: createSidecarContextProvider({ fetch: contextFetch }) });
      const conversation = host.createConversation("doc_1");
      const run = host.startConversationRun("doc_1", conversation.id, { message: { content: "请处理引用", references: [reference] }, context: { editor_snapshot: snapshot } });
      await host.waitForRun(run.id);
      expect(host.getAgentRun(run.id).status).toBe("completed");
      expect(contextFetch).not.toHaveBeenCalled();
      expect(JSON.stringify(requests[0]?.prompt.conversation)).toContain(snapshot.plain_text);
      expect(requests[0]?.prompt.conversation[0]?.content).toContain(reference.comment);
      const restored = createSqliteAgentHostStore(file);
      try { expect(restored.listMessages(conversation.id)[0]?.references).toEqual([reference]); }
      finally { restored.close(); }
    } finally { store?.close(); rmSync(directory, { recursive: true, force: true }); }
  });

  it("rejects a cross-document or stale-session reference before creating any messages", async () => {
    const runtime = createHarnessRuntime();
    const host = createAgentHost({ runtime, packs: [{ id: "resume", capabilityPolicy: {}, primaryAgentId: "resume.primary" }] });
    const conversation = host.createConversation("doc_1");
    for (const bad of [{ ...reference, document_id: "doc_other" }, { ...reference, source: { ...reference.source, editor_session_id: "old_editor" } }]) {
      expect(() => host.startConversationRun("doc_1", conversation.id, { message: { content: "修改", references: [bad] }, context: { editor_snapshot: snapshot } })).toThrow("invalid_editor_reference");
    }
    expect(host.listMessages(conversation.id)).toHaveLength(0);
  });

  it("forwards current document operations to Sidecar without implementing the transformation in Host", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ doc_json: snapshot.doc_json, effects: [], catalog_revision: "catalog", node_origins: [{ before_path: [0], after_path: [0] }], text_origins: [] })));
    const service = createSidecarEditorService("http://127.0.0.1:5517", fetchMock);
    const operations = [{ capability: "text.format", parameters: { path: [0], text: reference.text, mark: "bold" } }];
    const result = await service.prepare({ snapshot, operations, catalogRevision: "catalog", summary: "强调重点", signal: new AbortController().signal });
    expect(result).toMatchObject({ before_doc_json: snapshot.doc_json, document_id: snapshot.document_id, content_revision: snapshot.content_revision, node_origins: [{ before_path: [0], after_path: [0] }] });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:5517/editor/prepare");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ doc_json: snapshot.doc_json, operations, catalog_revision: "catalog" });
  });
});
