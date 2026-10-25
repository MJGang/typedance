import { describe, expect, it, vi } from "vitest";
import { createHarnessRuntime, type HarnessModelRequest } from "@typedance/harness-core";
import type { CanvasMutationMode, EditorRequest, EditorSnapshot } from "@typedance/contracts";
import { createAgentHost } from "../src";
import { createResumePluginLoader, registerResumeWorkbenchPlugin } from "../src/resume-plugin";

const snapshot: EditorSnapshot = {
  document_id: "doc_1", editor_session_id: "editor_1", content_revision: 2, canvas_version: 1,
  doc_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "当前原文" }] }] },
  plain_text: "当前原文", print_snapshot: { html: "<p>当前原文</p>", page_width: 794, page_height: 1123, page_tops: [0] },
};
const updated: EditorSnapshot = { ...snapshot, content_revision: 3,
  doc_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "更新后的原文" }] }] },
  plain_text: "更新后的原文", print_snapshot: { ...snapshot.print_snapshot!, html: "<p>更新后的原文</p>" },
};

async function setup(mode: CanvasMutationMode) {
  const requests: HarnessModelRequest[] = [];
  const loader = createResumePluginLoader();
  const runtime = createHarnessRuntime({ skillContentLoader: loader.createSkillContentLoader(), model: { stream: async function* (request) {
    requests.push(request);
    const pass = requests.length;
    const tool = pass === 1 ? { name: "resume.capabilities", input: {} }
      : pass === 2 ? { name: "resume.inspect", input: {} }
      : pass === 3 ? { name: "resume.edit", input: { catalog_revision: "current", content_revision: 2, summary: "改写原文", operations: [{ capability: "text.replace", parameters: { path: [0], text: "当前原文", replacement: "更新后的原文" } }] } }
      : pass === 4 ? { name: "resume.view_pages", input: { pages: [1] } } : undefined;
    if (tool) yield { type: "tool_call", call: { id: `call_${pass}`, origin: "plugin", ...tool } };
    yield { type: "final", output: {} };
  } } });
  await registerResumeWorkbenchPlugin(runtime, loader);
  const prepare = vi.fn(async () => ({ id: "transaction", document_id: "doc_1", editor_session_id: "editor_1", content_revision: 2,
    before_doc_json: snapshot.doc_json, doc_json: updated.doc_json, summary: "改写原文", effects: [{ capability: "text.replace", title: "改写文字", effect: "content" }], catalog_revision: "current", node_origins: [], text_origins: [] }));
  const pageReader = vi.fn(async () => ({ page_count: 1, pages: [{ page: 1, width: 794, height: 1123, image_url: "data:image/png;base64,aGVsbG8=" }] }));
  const host = createAgentHost({ runtime, packs: [{ id: "resume", capabilityPolicy: { scopeIds: ["pack:resume"] }, primaryAgentId: "resume.primary" }], resumeTools: {
    pageReader, supportsImages: () => true, editor: {
      catalog: async () => ({ revision: "current", scope: "current_document", units: {}, template_schema: {}, operations: [] }),
      inspect: async (value) => ({ text: value.plain_text }), prepare,
    },
  } });
  const conversation = host.createConversation("doc_1");
  const run = host.startConversationRun("doc_1", conversation.id, { mutationMode: mode, message: { content: "改写并检查效果" }, context: { editor_snapshot: snapshot } });
  const handled = new Set<string>();
  async function nextRequest() {
    let result: EditorRequest | undefined;
    await vi.waitFor(() => {
      result = host.listAgentRunEvents(run.id).filter((event) => event.type === "editor_request")
        .map((event) => event.payload.request as EditorRequest).find((request) => !handled.has(request.id));
      expect(result).toBeDefined();
    });
    handled.add(result!.id);
    return result!;
  }
  async function answerSnapshot(value = snapshot) {
    const request = await nextRequest();
    expect(request.kind).toBe("snapshot");
    host.respondToEditorRequest(run.id, request.id, { status: "snapshot", snapshot: value });
    return request;
  }
  return { host, run, requests, prepare, pageReader, nextRequest, answerSnapshot };
}

describe("live editor execution lifecycle", () => {
  it("returns unchanged decisions and the current snapshot to the model without claiming a write", async () => {
    const test = await setup("review");
    try {
      await test.answerSnapshot();
      await test.answerSnapshot();
      const request = await test.nextRequest();
      test.host.respondToEditorRequest(test.run.id, request.id, { status: "unchanged", snapshot });
      await test.answerSnapshot();
      await test.answerSnapshot();
      await test.host.waitForRun(test.run.id);
      const result = JSON.parse(String(test.requests[3]?.prompt.conversation.find((message) => message.role === "tool" && message.toolName === "resume.edit")?.content)).output;
      expect(result).toMatchObject({ status: "unchanged", content_revision: 2, current: { text: "当前原文" } });
      expect(result).not.toHaveProperty("persisted");
    } finally { if (test.host.getAgentRun(test.run.id).status === "running") test.host.cancelAgentRun(test.run.id); }
  });

  it.each(["review", "solo"] as const)("%s waits for actual execution then views the updated page snapshot", async (mode) => {
    const test = await setup(mode);
    try {
      await test.answerSnapshot();
      await test.answerSnapshot();
      const request = await test.nextRequest();
      expect(request.kind).toBe("transaction");
      expect(request.mode).toBe(mode);
      expect(test.host.getAgentRun(test.run.id).status).toBe("running");
      expect(test.pageReader).not.toHaveBeenCalled();
      test.host.respondToEditorRequest(test.run.id, request.id, { status: "applied", snapshot: updated });
      await test.answerSnapshot(updated);
      await test.answerSnapshot(updated);
      await test.host.waitForRun(test.run.id);
      expect(test.host.getAgentRun(test.run.id).status).toBe("completed");
      expect(test.pageReader).toHaveBeenCalledWith(expect.objectContaining({ snapshot: updated }));
      expect(JSON.stringify(test.requests[3]?.prompt.conversation)).toContain("更新后的原文");
      expect(JSON.stringify(test.requests[5]?.prompt.conversation)).toContain("Final editor evidence");
      const audit = test.requests[5]?.prompt.conversation.find((message) => message.role === "user" && message.internal === "completion");
      expect(String(audit?.content)).toContain('"status":"applied","persisted":false');
      expect(test.host.listAgentRunEvents(test.run.id)).toContainEqual(expect.objectContaining({ type: "editor_response", payload: expect.objectContaining({ status: "applied", content_revision: 3 }) }));
      expect(() => test.host.respondToEditorRequest(test.run.id, request.id, { status: "applied", snapshot: updated })).not.toThrow();
      expect(test.host.listAgentRunEvents(test.run.id).filter((event) => event.type === "editor_response" && event.payload.request_id === request.id)).toHaveLength(1);
      expect(() => test.host.respondToEditorRequest(test.run.id, request.id, { status: "rejected" })).toThrow("conflict");
    } finally { if (test.host.getAgentRun(test.run.id).status === "running") test.host.cancelAgentRun(test.run.id); }
  });

  it("suggest mode prepares validated advice without requesting any write", async () => {
    const test = await setup("suggest");
    try {
      await test.answerSnapshot();
      await test.answerSnapshot();
      await test.answerSnapshot();
      await test.host.waitForRun(test.run.id);
      const requests = test.host.listAgentRunEvents(test.run.id).filter((event) => event.type === "editor_request").map((event) => event.payload.request as EditorRequest);
      expect(requests.every((request) => request.kind === "snapshot")).toBe(true);
      expect(test.prepare).toHaveBeenCalledOnce();
      expect(test.pageReader).toHaveBeenCalledWith(expect.objectContaining({ snapshot }));
      expect(JSON.parse(String(test.requests[3]?.prompt.conversation.find((message) => message.role === "tool" && message.toolName === "resume.edit")?.content)).output.status).toBe("suggested");
    } finally { if (test.host.getAgentRun(test.run.id).status === "running") test.host.cancelAgentRun(test.run.id); }
  });

  it("rejecting a proposal preserves the original snapshot", async () => {
    const test = await setup("review");
    try {
      await test.answerSnapshot();
      await test.answerSnapshot();
      const request = await test.nextRequest();
      test.host.respondToEditorRequest(test.run.id, request.id, { status: "rejected" });
      await test.answerSnapshot();
      await test.answerSnapshot();
      await test.host.waitForRun(test.run.id);
      expect(test.pageReader).toHaveBeenCalledWith(expect.objectContaining({ snapshot }));
      expect(JSON.parse(String(test.requests[3]?.prompt.conversation.find((message) => message.role === "tool" && message.toolName === "resume.edit")?.content)).output.status).toBe("rejected");
    } finally { if (test.host.getAgentRun(test.run.id).status === "running") test.host.cancelAgentRun(test.run.id); }
  });

  it("concurrent edits invalidate the planned revision before preparing a write", async () => {
    const test = await setup("solo");
    try {
      await test.answerSnapshot();
      await test.answerSnapshot(updated);
      await test.answerSnapshot(updated);
      await test.host.waitForRun(test.run.id);
      expect(test.prepare).not.toHaveBeenCalled();
      expect(JSON.stringify(test.requests[3]?.prompt.conversation)).toContain("用户已修改画布");
      expect(test.host.listAgentRunEvents(test.run.id).filter((event) => event.type === "editor_request")).toHaveLength(3);
    } finally { if (test.host.getAgentRun(test.run.id).status === "running") test.host.cancelAgentRun(test.run.id); }
  });

  it("rejects cross-document replies, cancels pending requests and forbids late execution", async () => {
    const test = await setup("review");
    const request = await test.nextRequest();
    expect(() => test.host.respondToEditorRequest(test.run.id, request.id, { status: "snapshot", snapshot: { ...snapshot, document_id: "other" } })).toThrow("不属于");
    test.host.cancelAgentRun(test.run.id);
    await test.host.waitForRun(test.run.id);
    expect(test.host.getAgentRun(test.run.id).status).toBe("cancelled");
    expect(() => test.host.getEditorRequest(test.run.id, request.id)).toThrow("editor_session_ended");
    expect(() => test.host.respondToEditorRequest(test.run.id, request.id, { status: "snapshot", snapshot })).toThrow("editor_response_conflict");
    expect(test.host.listAgentRunEvents(test.run.id)).toContainEqual(expect.objectContaining({ type: "editor_response", payload: expect.objectContaining({ request_id: request.id, status: "failed" }) }));
    expect(test.prepare).not.toHaveBeenCalled();
  });
});
