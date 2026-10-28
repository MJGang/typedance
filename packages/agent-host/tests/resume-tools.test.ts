import { describe, expect, it, vi } from "vitest";
import { createHarnessRuntime, type HarnessModelRequest } from "@typedance/harness-core";
import type { CanvasMutationMode, EditorRequest, EditorSnapshot } from "@typedance/contracts";
import { createAgentHost } from "../src";
import { modelRuntimeConfiguration } from "../src/model-catalog";
import { createResumePluginLoader, registerResumeWorkbenchPlugin } from "../src/resume-plugin";
import { createSidecarPageReader, VIEW_RESUME_PAGES_TOOL_NAME, type ResumeToolServices } from "../src/resume-tools";

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

type ScriptCall = { name: string; input: Record<string, unknown> } | ((request: HarnessModelRequest) => { name: string; input: Record<string, unknown> });
async function scriptedTools(services: Partial<ResumeToolServices> = {}) {
  let script: ScriptCall[] = [];
  const requests: HarnessModelRequest[] = [];
  const loader = createResumePluginLoader();
  const runtime = createHarnessRuntime({ skillContentLoader: loader.createSkillContentLoader(), model: { stream: async function* (request) {
    requests.push(request);
    const next = script.shift();
    const tool = typeof next === "function" ? next(request) : next;
    if (tool) yield { type: "tool_call", call: { id: `call_${requests.length}`, origin: "plugin", ...tool } };
    yield { type: "final", output: {} };
  } } });
  await registerResumeWorkbenchPlugin(runtime, loader);
  const pageReader = vi.fn(async ({ pages }: { pages: number[] }) => ({ page_count: 2, pages: pages.map(page => ({ ...images.pages[0], page })) }));
  const host = createAgentHost({ runtime, packs: [{ id: "resume", capabilityPolicy: { scopeIds: ["pack:resume"] }, primaryAgentId: "resume.primary" }],
    resolveModelRuntimeConfiguration: () => modelRuntimeConfiguration("deepseek-flash", "high"),
    resumeTools: { pageReader, supportsImages: () => true, editor: { catalog: vi.fn(), inspect: vi.fn(async () => ({})), prepare: vi.fn() }, ...services } });
  return { host, pageReader, requests, async run(calls: ScriptCall[], value = snapshot, mode: CanvasMutationMode = "suggest", refresh = () => value, expectedStatus = "completed") {
    script = [...calls];
    const before = requests.length;
    const conversation = host.createConversation("doc_1");
    const run = host.startConversationRun("doc_1", conversation.id, { mutationMode: mode, message: { content: "测试当前画布" }, context: { editor_snapshot: value } });
    await Promise.all([host.waitForRun(run.id), (async () => {
      for await (const event of host.streamAgentRunEvents(run.id)) {
        if (event.type === "editor_request") {
          const request = event.payload.request as EditorRequest;
          expect(request.kind).toBe("snapshot");
          host.respondToEditorRequest(run.id, request.id, { status: "snapshot", snapshot: refresh() });
        }
        if (["run_completed", "run_failed", "run_cancelled"].includes(event.type)) break;
      }
    })()]);
    expect(host.getAgentRun(run.id).status).toBe(expectedStatus);
    return { run, requests: requests.slice(before) };
  } };
}

function lastToolOutput(request: HarnessModelRequest) {
  return JSON.parse(String(request.prompt.conversation.at(-1)?.content)).output;
}

describe("host-owned resume tools", () => {
  it("returns a normal resume in one default read and offers revision-checked continuation for long UTF-16 text", async () => {
    const test = await scriptedTools();
    const normal = await test.run([{ name: "resume.read", input: {} }], { ...snapshot, plain_text: "文".repeat(4418) });
    expect(lastToolOutput(normal.requests[1])).toMatchObject({ returned_characters: 4418, truncated: false, next_read: null });
    const long = await test.run([{ name: "resume.read", input: {} }, request => ({ name: "resume.read", input: lastToolOutput(request).next_read })],
      { ...snapshot, plain_text: "文".repeat(11998) + "😀结尾" });
    expect(lastToolOutput(long.requests[1])).toMatchObject({ offset: 0, returned_characters: 12000, offset_unit: "utf16", truncated: true,
      next_read: { offset: 12000, length: 12000, expected_revision: { editor_session_id: "editor", content_revision: 3 } } });
    expect(lastToolOutput(long.requests[2])).toMatchObject({ text: "结尾", next_read: null });
    const stale = await test.run([{ name: "resume.read", input: { offset: 12000, expected_revision: { editor_session_id: "editor", content_revision: 3 } } }],
      { ...snapshot, plain_text: "x".repeat(13000), content_revision: 4 });
    expect(String(stale.requests[1].prompt.conversation.at(-1)?.content)).toContain("不能拼接不同修订");
  });

  it("reuses overlapping pages across inspection and runs, and invalidates on revision or print changes", async () => {
    const test = await scriptedTools();
    await test.run([{ name: "resume.view_pages", input: { pages: [2] } }, { name: "resume.inspect", input: {} }, { name: "resume.view_pages", input: { pages: [1, 2] } }]);
    expect(test.pageReader.mock.calls.map(([value]) => value.pages)).toEqual([[2], [1]]);
    await test.run([{ name: "resume.view_pages", input: { pages: [2, 1] } }]);
    expect(test.pageReader).toHaveBeenCalledTimes(2);
    await test.run([{ name: "resume.view_pages", input: { pages: [2] } }], { ...snapshot, content_revision: 4 });
    await test.run([{ name: "resume.view_pages", input: { pages: [2] } }], { ...snapshot, print_snapshot: { ...snapshot.print_snapshot!, html: "<p>new geometry</p>" } });
    expect(test.pageReader).toHaveBeenCalledTimes(4);
    const bad = await test.run([{ name: "resume.view_pages", input: { pages: [3] } }]);
    expect(String(bad.requests[1].prompt.conversation.at(-1)?.content)).toContain("页码超出");
    expect(test.pageReader).toHaveBeenCalledTimes(4);
  });

  it("returns a validated suggestion preview without creating an approval transaction or mutating the canvas", async () => {
    const operations = [{ capability: "text.replace", parameters: { path: [0], text: "教育经历", replacement: "教育背景" } }];
    const prepare = vi.fn(async () => ({ id: "transaction", document_id: "doc_1", editor_session_id: "editor", content_revision: 3,
      before_doc_json: snapshot.doc_json, doc_json: { type: "doc", content: [] }, summary: "替换标题", effects: [], catalog_revision: "current", node_origins: [], text_origins: [] }));
    const test = await scriptedTools({ editor: { catalog: vi.fn(), inspect: vi.fn(), prepare } });
    const result = await test.run([{ name: "resume.edit", input: { catalog_revision: "current", content_revision: 3, operations, summary: "替换标题" } }]);
    expect(prepare).toHaveBeenCalledOnce();
    expect(lastToolOutput(result.requests[1])).toMatchObject({ applied: false, pending_approval: false, verification_required: false,
      next_action: "switch_to_review_and_resubmit", preview: { operations, operation_count: 1, truncated: false } });
    expect(test.host.listAgentRunEvents(result.run.id).filter(event => event.type === "editor_request")
      .every(event => (event.payload.request as EditorRequest).kind === "snapshot")).toBe(true);
  });

  it("does not cache a render that finishes after its run was cancelled", async () => {
    let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    let release!: (value: typeof images) => void;
    const pending = new Promise<typeof images>(resolve => { release = resolve; });
    const pageReader = vi.fn().mockImplementationOnce(() => { entered(); return pending; }).mockResolvedValue(images);
    const test = await scriptedTools({ pageReader });
    // Start the script, then cancel while the underlying renderer ignores cancellation.
    const cancelled = test.run([{ name: "resume.view_pages", input: { pages: [2] } }], snapshot, "suggest", () => snapshot, "cancelled");
    await ready;
    const conversation = test.host.listConversations("doc_1")[0];
    const run = test.host.getConversationActiveRun(conversation.id)!;
    test.host.cancelAgentRun(run.id, "stop");
    release(images);
    await cancelled;
    await test.run([{ name: "resume.view_pages", input: { pages: [2] } }]);
    expect(pageReader).toHaveBeenCalledTimes(2);
  });

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
