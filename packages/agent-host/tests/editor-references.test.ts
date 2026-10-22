import { describe, expect, it, vi } from "vitest";
import { createHarnessRuntime, type HarnessModelRequest } from "@typedance/harness-core";
import type { EditorReference, EditorSnapshot, TextEditPreview } from "@typedance/contracts";
import { createAgentHost, createJsonFileAgentHostStore } from "../src";
import { createResumePluginLoader, registerResumeWorkbenchPlugin } from "../src/resume-plugin";
import { createSidecarContextProvider } from "../src/sidecar-context";
import { createSidecarTextEditPreviewer, TEXT_EDIT_TOOL_NAME } from "../src/text-edit";
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
const preview: TextEditPreview = {
  kind: "text_edit_preview", id: "preview_1", document_id: "doc_1", reference_id: "ref_1", editor_session_id: "editor_1",
  original_text: reference.text, replacement: "精简后的经历", replacement_content: [{ type: "text", text: "精简后的经历" }], summary: "去掉重复表达",
};

describe("editor references", () => {
  it("uses unsaved editor content, keeps each instruction in persisted messages, and executes a preview through the generic runtime", async () => {
    const requests: HarnessModelRequest[] = [];
    const loader = createResumePluginLoader();
    const runtime = createHarnessRuntime({ skillContentLoader: loader.createSkillContentLoader(), model: {
      stream: async function* (request) {
        requests.push(request);
        if (requests.length === 1) yield { type: "tool_call", call: { id: "call_1", name: TEXT_EDIT_TOOL_NAME, origin: "plugin", input: { reference_id: "ref_1", replacement: preview.replacement, summary: preview.summary } } };
        else yield { type: "assistant_delta", messageId: "answer", delta: "已生成修改预览，请确认后应用。" };
        yield { type: "final", output: {} };
      },
    } });
    await registerResumeWorkbenchPlugin(runtime, loader);
    const directory = mkdtempSync(join(tmpdir(), "typedance-reference-test-"));
    try {
      const file = join(directory, "store.json");
      const contextFetch = vi.fn<typeof fetch>();
      const prepare = vi.fn(async () => preview);
      const host = createAgentHost({ runtime, packs: [{ id: "resume", capabilityPolicy: { scopeIds: ["pack:resume"] }, primaryAgentId: "resume.primary" }],
        store: createJsonFileAgentHostStore(file), contextProvider: createSidecarContextProvider({ fetch: contextFetch }),
        resumeTools: { textEditPreviewer: prepare, pageReader: vi.fn(), supportsImages: () => true } });
      const conversation = host.createConversation("doc_1");
      const run = host.startConversationRun("doc_1", conversation.id, { message: { content: "请处理引用", references: [reference] }, context: { editor_snapshot: snapshot } });
      await host.waitForRun(run.id);
      expect(host.getAgentRun(run.id).status).toBe("completed");
      expect(contextFetch).not.toHaveBeenCalled();
      expect(JSON.stringify(requests[0]?.prompt.contextual)).toContain(snapshot.plain_text);
      expect(requests[0]?.prompt.conversation[0]?.content).toContain(reference.comment);
      expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ snapshot, reference, replacement: preview.replacement }));
      expect(host.listAgentRunEvents(run.id)).toContainEqual(expect.objectContaining({ type: "tool_call_completed", payload: { result: expect.objectContaining({ output: preview }) } }));
      expect(() => host.recordTextEditDecision(run.id, "missing", "applied")).toThrow("text_edit_preview_not_found");
      expect(() => host.recordTextEditDecision(run.id, preview.id, "undone")).toThrow("invalid_text_edit_decision");
      const applied = host.recordTextEditDecision(run.id, preview.id, "applied");
      expect(host.recordTextEditDecision(run.id, preview.id, "applied")).toEqual(applied);
      host.recordTextEditDecision(run.id, preview.id, "undone");
      host.recordTextEditDecision(run.id, preview.id, "applied");
      expect(() => host.recordTextEditDecision(run.id, preview.id, "ignored")).toThrow("invalid_text_edit_decision");
      const restored = createJsonFileAgentHostStore(file);
      expect(restored.listMessages(conversation.id)[0]?.references).toEqual([reference]);
      expect(restored.listRunEvents(run.id).filter((event) => event.type === "text_edit_decision").map((event) => event.payload.status)).toEqual(["applied", "undone", "applied"]);
    } finally { rmSync(directory, { recursive: true, force: true }); }
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

  it("keeps preview preparation deterministic and forwards the current canvas to Sidecar", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ original_text: reference.text, replacement: "改写", replacement_content: [{ type: "text", text: "改写" }] })));
    const prepare = createSidecarTextEditPreviewer("http://127.0.0.1:5517", fetchMock);
    const result = await prepare({ snapshot, reference, replacement: "改写", summary: "清楚一些", signal: new AbortController().signal });
    expect(result).toMatchObject({ kind: "text_edit_preview", reference_id: reference.id, original_text: reference.text, replacement: "改写" });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ doc_json: snapshot.doc_json, from_position: 1, expected_text: reference.text });
  });
});
