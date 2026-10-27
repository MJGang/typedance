import { describe, expect, it, vi } from "vitest";
import { createHarnessRuntime, type HarnessModelRequest } from "@typedance/harness-core";
import type { EditorRequest, EditorSnapshot } from "@typedance/contracts";
import { createAgentHost } from "../src";
import { createResumePluginLoader, registerResumeWorkbenchPlugin } from "../src/resume-plugin";
import { createSidecarPageReader, VIEW_RESUME_PAGES_TOOL_NAME } from "../src/resume-tools";

const snapshot: EditorSnapshot = {
  document_id: "doc_1", editor_session_id: "editor", content_revision: 3, canvas_version: 1,
  doc_json: { type: "doc", content: [] }, plain_text: "尚未保存的当前内容",
  print_snapshot: { html: "<div>尚未保存的当前内容</div>", page_width: 794, page_height: 1123, page_tops: [0, 1147] },
};
const images = { page_count: 2, pages: [{ page: 2, width: 794, height: 1123, image_url: "data:image/png;base64,aGVsbG8=" }] };

async function answerSnapshotRequests(host: ReturnType<typeof createAgentHost>, runId: string, value: EditorSnapshot) {
  for await (const event of host.streamAgentRunEvents(runId)) {
    if (event.type === "editor_request") {
      const request = event.payload.request as EditorRequest;
      expect(request.kind).toBe("snapshot");
      host.respondToEditorRequest(runId, request.id, { status: "snapshot", snapshot: value });
    }
    if (["run_completed", "run_failed", "run_cancelled"].includes(event.type)) break;
  }
}

describe("host-owned resume tools", () => {
  it("forwards selected schemas and targeted detail reads without adding automatic full-document results", async () => {
    const requests: HarnessModelRequest[] = [];
    const loader = createResumePluginLoader();
    const runtime = createHarnessRuntime({ skillContentLoader: loader.createSkillContentLoader(), model: { stream: async function* (request) {
      requests.push(request);
      const tool = requests.length === 1 ? { name: "resume.capabilities", input: { operation_ids: ["text.replace"] } }
        : requests.length === 2 ? { name: "resume.inspect", input: { view: "detail", paths: [[1]], text_limit: 12000 } } : undefined;
      if (tool) yield { type: "tool_call", call: { id: `call_${requests.length}`, origin: "plugin", ...tool } };
      yield { type: "final", output: {} };
    } } });
    await registerResumeWorkbenchPlugin(runtime, loader);
    const catalog = vi.fn(async () => ({ revision: "current", scope: "current_document" as const, units: {},
      operations: [{ id: "text.replace", title: "替换", description: "精确替换", effect: "content" as const, parameters: { type: "object" } }] }));
    const inspect = vi.fn(async () => ({ view: "detail", nodes: [{ path: [1], text: "定向正文" }] }));
    const host = createAgentHost({ runtime, packs: [{ id: "resume", capabilityPolicy: { scopeIds: ["pack:resume"] }, primaryAgentId: "resume.primary" }],
      resumeTools: { pageReader: vi.fn(), supportsImages: () => true, editor: { catalog, inspect, prepare: vi.fn() } } });
    const conversation = host.createConversation("doc_1");
    const run = host.startConversationRun("doc_1", conversation.id, { message: { content: "读取指定段落" }, context: { editor_snapshot: snapshot } });
    await Promise.all([host.waitForRun(run.id), answerSnapshotRequests(host, run.id, snapshot)]);
    expect(host.getAgentRun(run.id).status).toBe("completed");
    expect(catalog).toHaveBeenCalledWith(expect.any(AbortSignal), ["text.replace"]);
    expect(inspect).toHaveBeenCalledOnce();
    expect(inspect).toHaveBeenCalledWith(snapshot, expect.any(AbortSignal), { view: "detail", paths: [[1]], text_limit: 12000 });
    expect(String(requests[2]?.prompt.conversation.at(-1)?.content)).toContain("定向正文");
  });

  it("reads text beyond the initial context budget and explains unavailable vision without rendering", async () => {
    const requests: HarnessModelRequest[] = [];
    const loader = createResumePluginLoader();
    const runtime = createHarnessRuntime({ skillContentLoader: loader.createSkillContentLoader(), model: { stream: async function* (request) {
      requests.push(request);
      if (requests.length === 1) yield { type: "tool_call", call: { id: "read", name: "resume.read", origin: "plugin", input: { offset: 12000, length: 100 } } };
      if (requests.length === 2) yield { type: "tool_call", call: { id: "view", name: VIEW_RESUME_PAGES_TOOL_NAME, origin: "plugin", input: { pages: [1] } } };
      yield { type: "final", output: {} };
    } } });
    await registerResumeWorkbenchPlugin(runtime, loader);
    const pageReader = vi.fn();
    const host = createAgentHost({ runtime, packs: [{ id: "resume", capabilityPolicy: { scopeIds: ["pack:resume"] }, primaryAgentId: "resume.primary" }],
      resumeTools: { pageReader, supportsImages: () => false, editor: { catalog: vi.fn(), inspect: vi.fn(), prepare: vi.fn() } } });
    const conversation = host.createConversation("doc_1");
    const run = host.startConversationRun("doc_1", conversation.id, { message: { content: "检查末尾" }, context: { editor_snapshot: { ...snapshot, plain_text: "x".repeat(12000) + "末尾最新内容" } } });
    await Promise.all([host.waitForRun(run.id), answerSnapshotRequests(host, run.id, { ...snapshot, plain_text: "x".repeat(12000) + "末尾最新内容" })]);
    const readOutput = JSON.parse(String(requests[1]?.prompt.conversation.at(-1)?.content));
    expect(readOutput.output).toMatchObject({ text: "末尾最新内容", next_offset: null, content_revision: 3 });
    expect(String(requests[2]?.prompt.conversation.at(-1)?.content)).toContain("deepseek-flash");
    expect(pageReader).not.toHaveBeenCalled();
  });

  it("refreshes live snapshots without selection and reuses images only when print content is unchanged", async () => {
    const requests: HarnessModelRequest[] = [];
    const loader = createResumePluginLoader();
    const runtime = createHarnessRuntime({ skillContentLoader: loader.createSkillContentLoader(), model: { stream: async function* (request) {
      requests.push(request);
      if (requests.length <= 2) yield { type: "tool_call", call: { id: `view_${requests.length}`, name: VIEW_RESUME_PAGES_TOOL_NAME, origin: "plugin", input: { pages: [2] } } };
      yield { type: "final", output: {} };
    } } });
    await registerResumeWorkbenchPlugin(runtime, loader);
    const pageReader = vi.fn(async () => images);
    const host = createAgentHost({ runtime, packs: [{ id: "resume", capabilityPolicy: { scopeIds: ["pack:resume"] }, primaryAgentId: "resume.primary" }],
      resumeTools: { pageReader, supportsImages: () => true, editor: { catalog: vi.fn(), inspect: vi.fn(), prepare: vi.fn() } } });
    expect(pageReader).not.toHaveBeenCalled();
    const conversation = host.createConversation("doc_1");
    const run = host.startConversationRun("doc_1", conversation.id, { message: { content: "看看第二页为什么空" }, context: { editor_snapshot: snapshot } });
    await Promise.all([host.waitForRun(run.id), answerSnapshotRequests(host, run.id, snapshot)]);
    expect(host.getAgentRun(run.id).status).toBe("completed");
    expect(pageReader).toHaveBeenCalledTimes(1);
    expect(pageReader).toHaveBeenCalledWith(expect.objectContaining({ snapshot, pages: [2] }));
    expect(requests[1]?.prompt.conversation.at(-1)).toMatchObject({ role: "tool", content: expect.arrayContaining([{ type: "image", image_url: images.pages[0].image_url, detail: "high" }]) });
    const events = host.listAgentRunEvents(run.id);
    expect(JSON.stringify(events)).not.toContain("data:image/");
    expect(JSON.stringify(events)).toContain("canvas_pages");
  });

  it("passes only the current static snapshot to Sidecar and rejects mismatched page results", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(images)));
    const read = createSidecarPageReader("http://127.0.0.1:5517", fetchMock);
    await read({ snapshot, pages: [2], signal: new AbortController().signal });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ print_snapshot: snapshot.print_snapshot, pages: [2] });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ...images, page_count: 9 })));
    await expect(read({ snapshot, pages: [2], signal: new AbortController().signal })).rejects.toThrow("不一致");
  });
});
