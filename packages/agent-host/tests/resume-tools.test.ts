import { describe, expect, it, vi } from "vitest";
import { createHarnessRuntime, type HarnessModelRequest } from "@typedance/harness-core";
import type { EditorSnapshot } from "@typedance/contracts";
import { createAgentHost } from "../src";
import { createResumePluginLoader, registerResumeWorkbenchPlugin } from "../src/resume-plugin";
import { createSidecarPageReader, VIEW_RESUME_PAGES_TOOL_NAME } from "../src/resume-tools";

const snapshot: EditorSnapshot = {
  document_id: "doc_1", editor_session_id: "editor", content_revision: 3, canvas_version: 1,
  doc_json: { type: "doc", content: [] }, plain_text: "尚未保存的当前内容",
  print_snapshot: { html: "<div>尚未保存的当前内容</div>", page_width: 794, page_height: 1123, page_tops: [0, 1147] },
};
const images = { page_count: 2, pages: [{ page: 2, width: 794, height: 1123, image_url: "data:image/png;base64,aGVsbG8=" }] };

describe("host-owned resume tools", () => {
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
      resumeTools: { pageReader, supportsImages: () => false, textEditPreviewer: vi.fn() } });
    const conversation = host.createConversation("doc_1");
    const run = host.startConversationRun("doc_1", conversation.id, { message: { content: "检查末尾" }, context: { editor_snapshot: { ...snapshot, plain_text: "x".repeat(12000) + "末尾最新内容" } } });
    await host.waitForRun(run.id);
    const readOutput = JSON.parse(String(requests[1]?.prompt.conversation.at(-1)?.content));
    expect(readOutput.output).toMatchObject({ text: "末尾最新内容", next_offset: null, content_revision: 3 });
    expect(String(requests[2]?.prompt.conversation.at(-1)?.content)).toContain("deepseek-flash");
    expect(pageReader).not.toHaveBeenCalled();
  });

  it("does not render eagerly; no selection is needed and repeated reads reuse the turn snapshot", async () => {
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
      resumeTools: { pageReader, supportsImages: () => true, textEditPreviewer: vi.fn() } });
    expect(pageReader).not.toHaveBeenCalled();
    const conversation = host.createConversation("doc_1");
    const run = host.startConversationRun("doc_1", conversation.id, { message: { content: "看看第二页为什么空" }, context: { editor_snapshot: snapshot } });
    await host.waitForRun(run.id);
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
