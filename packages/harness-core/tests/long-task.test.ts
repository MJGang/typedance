import { describe, expect, it, vi } from "vitest";
import { createHarnessRuntime, MemoryHarnessCheckpointStore, boundToolContent, type HarnessModelAdapter, type HarnessModelRequest, type HarnessRuntimeOptions, type HarnessRuntime } from "../src";

function register(runtime: HarnessRuntime) {
  runtime.registerPlugin({ id: "test", name: "Test", version: "1", module_format: "esm", scopes: ["test"],
    agents: [{ id: "test.agent", name: "Test", role: "primary", allowed_tool_names: ["test.work"] }] });
}
function setup(model: HarnessModelAdapter, options: HarnessRuntimeOptions = {}) {
  const runtime = createHarnessRuntime({ ...options, model }); register(runtime);
  const run = runtime.createRun({ capability_policy: { scope_ids: ["test"] }, user_message: "Complete all three deliverables" });
  const start = () => runtime.runAgentTurn({ runId: run.id, agentId: "test.agent", messages: [], inputIds: ["initial"], prompt: {
    developer: [{ slot: "developer", source: "host.rules", content: "Never mutate without approval" }],
    contextual: [{ slot: "contextual", source: "source", content: "Current authoritative facts" }],
    conversation: [{ role: "user", content: "Complete all three deliverables" }],
  } });
  return { runtime, run, start };
}
const call = (id: string) => ({ type: "tool_call" as const, call: { id, name: "test.work", origin: "plugin" as const, input: {} } });
const smallWindow = { maxInputTokens: 5_000, compactAtRatio: 0.6, retainedUserTokens: 600, summaryTokens: 300, toolOutputTokens: 1_600 };

describe("Codex-style long task execution", () => {
  it("keeps multiple tool images intact and bounds only their text, leaving the full request budget to context management", () => {
    const images = [{ type: "image" as const, image_url: "https://example.test/one.png" }, { type: "image" as const, image_url: "https://example.test/two.png" }];
    const content = boundToolContent([{ type: "text", text: "x".repeat(50_000) }, ...images], 8_000);
    expect(content).toEqual([expect.objectContaining({ type: "text", text: expect.stringContaining("truncated") }), ...images]);
  });
  it("runs 32 tool steps and retains paired results until the model finishes", async () => {
    let step = 0; let final: HarnessModelRequest | undefined;
    const { runtime, run, start } = setup({ async *stream(request) {
      if (step++ < 32) yield call(`work-${step}`);
      else { final = request; yield { type: "final", output: { complete: true } }; }
    } });
    const handler = vi.fn(() => ({ evidence: "verified" }));
    runtime.registerTool({ name: "test.work", origin: "plugin", handler });
    await start();
    expect(handler).toHaveBeenCalledTimes(32);
    expect(final!.prompt.conversation.filter((message) => message.role === "tool")).toHaveLength(32);
    expect(runtime.getCheckpoint(run.id)?.run.status).toBe("completed");
  });

  it("repeatedly summarizes history while preserving canonical rules, the task and new steering", async () => {
    let steps = 0; const requests: HarnessModelRequest[] = [];
    const { runtime, run, start } = setup({ async *stream(request) {
      requests.push(request);
      if (request.purpose === "compaction") {
        expect(request.availableTools).toEqual([]);
        if (requests.filter((item) => item.purpose === "compaction").length === 1) runtime.enqueueUserInput(run.id, {
          id: "steer", messages: [{ role: "user", content: "Keep the fourth requirement too" }],
          contextual: [{ slot: "contextual", source: "source", content: "Updated authoritative facts" }],
        });
        yield { type: "assistant_delta", messageId: "summary", delta: "Progress verified; preserve all four requirements. Continue remaining steps." };
        yield { type: "final", output: {} }; return;
      }
      if (steps++ < 12) yield call(`work-${steps}`);
      else yield { type: "final", output: { done: true } };
    } }, { contextWindow: smallWindow });
    runtime.registerTool({ name: "test.work", origin: "plugin", handler: () => ({ evidence: "x".repeat(3_000) }) });
    await start();
    const compacted = runtime.getEvents(run.id).filter((event) => event.type === "context.compacted");
    expect(compacted.length).toBeGreaterThan(1);
    const final = requests[requests.length - 1];
    expect(final.prompt.developer).toContainEqual(expect.objectContaining({ source: "host.rules", content: "Never mutate without approval" }));
    expect(final.prompt.contextual).toContainEqual(expect.objectContaining({ source: "harness.task", content: expect.stringContaining("Complete all three deliverables") }));
    expect(final.prompt.contextual).toContainEqual(expect.objectContaining({ source: "source", content: "Updated authoritative facts" }));
    expect(final.prompt.conversation).toContainEqual({ role: "user", content: "Keep the fourth requirement too" });
    expect(final.prompt.conversation.filter((message) => message.role === "user" && message.internal === "compaction")).toHaveLength(1);
    for (const request of requests) {
      const ids = new Set(request.prompt.conversation.flatMap((message) => message.role === "assistant" ? message.toolCalls?.map((tool) => tool.id) ?? [] : []));
      for (const message of request.prompt.conversation) if (message.role === "tool") expect(ids.has(message.toolCallId)).toBe(true);
    }
  });

  it("keeps the original history when a summary fails or cannot reduce the context", async () => {
    let steps = 0;
    const { runtime, run, start } = setup({ async *stream(request) {
      if (request.purpose === "compaction") throw new Error("summary unavailable");
      yield call(`work-${++steps}`);
    } }, { contextWindow: smallWindow });
    runtime.registerTool({ name: "test.work", origin: "plugin", handler: () => ({ evidence: "x".repeat(3_000) }) });
    await expect(start()).rejects.toThrow("summary unavailable");
    expect(runtime.getCheckpoint(run.id)?.prompt.conversation.some((message) => message.role === "tool")).toBe(true);
    expect(runtime.getCheckpoint(run.id)?.compactions).toBe(0);
    expect(runtime.getEvents(run.id).some((event) => event.type === "run.completed")).toBe(false);
  });

  it("resumes in a new runtime with a persisted plan, fresh constraints and uncertain calls closed without replay", async () => {
    const checkpoints = new MemoryHarnessCheckpointStore();
    let entered!: () => void; const waiting = new Promise<void>((resolve) => { entered = resolve; });
    const { runtime, run, start } = setup({ async *stream() {
      yield { type: "tool_call", call: { id: "plan", name: "update_plan", origin: "system", input: { items: [
        { id: "one", title: "Verify three deliverables", status: "in_progress" },
      ] } } };
      yield call("uncertain"); yield call("unstarted");
    } }, { checkpointStore: checkpoints });
    runtime.registerTool({ name: "test.work", origin: "plugin", handler: async () => { entered(); return new Promise(() => {}); } });
    const work = start(); await waiting;
    runtime.enqueueUserInput(run.id, { id: "pending", messages: [{ role: "user", content: "Preserve this accepted instruction" }] });
    runtime.cancelRun(run.id); await expect(work).rejects.toThrow();
    const saved = checkpoints.load(run.id)!;
    expect(saved.in_flight_tool_call_id).toBe("uncertain");
    const requests: HarnessModelRequest[] = [];
    const next = createHarnessRuntime({ checkpointStore: checkpoints, model: { async *stream(request) { requests.push(request); yield { type: "final", output: { done: true } }; } } });
    register(next);
    const handler = vi.fn(); next.registerTool({ name: "test.work", origin: "plugin", handler });
    const resumed = next.createRun({ capability_policy: { scope_ids: ["test"] }, user_message: "Continue" }, { id: "resumed" });
    await next.runAgentTurn({ runId: resumed.id, agentId: "test.agent", resumeFromRunId: run.id, messages: [{ role: "user", content: "Continue" }],
      prompt: { developer: [{ slot: "developer", source: "new.rules", content: "Fresh rules" }], contextual: [], conversation: [{ role: "user", content: "Continue" }] } });
    expect(handler).not.toHaveBeenCalled();
    expect(requests[0].prompt.developer.some((section) => section.source === "host.rules")).toBe(false);
    expect(requests[0].prompt.conversation).toContainEqual(expect.objectContaining({ role: "tool", toolCallId: "uncertain", content: expect.stringContaining("may have taken effect") }));
    expect(requests[0].prompt.conversation).toContainEqual({ role: "user", content: "Preserve this accepted instruction" });
    expect(next.getCheckpoint(resumed.id)?.objective).toBe("Complete all three deliverables");
    expect(next.getCheckpoint(resumed.id)?.plan[0].status).toBe("in_progress");
    expect(runtime.getRun(run.id).status).toBe("canceled");
  });

  it("continues after completion feedback and counts resource budgets across steering", async () => {
    let requests = 0;
    const completionCheck = vi.fn().mockReturnValueOnce({ complete: false, message: "Third deliverable is missing; inspect and finish it" }).mockReturnValue({ complete: true });
    const { runtime, run, start } = setup({ async *stream() { requests += 1; yield { type: "assistant_delta", messageId: "answer", delta: "Result" }; yield { type: "final", output: { done: true } }; } }, { completionCheck });
    await start(); expect(requests).toBe(2);
    expect(runtime.getEvents(run.id)).toContainEqual(expect.objectContaining({ type: "completion.blocked" }));
    let passes = 0;
    const limited = setup({ async *stream() { limited.runtime.enqueueUserInput(limited.run.id, { id: String(++passes), messages: [{ role: "user", content: "keep going" }] }); yield call(String(passes)); } }, { limits: { maxModelSteps: 3 } });
    limited.runtime.registerTool({ name: "test.work", origin: "plugin", handler: () => ({}) });
    await expect(limited.start()).rejects.toThrow("configured model execution budget");
    expect(passes).toBe(3);
    expect(limited.runtime.getRun(limited.run.id).status).toBe("failed");
  });

  it("cancels a compaction stream without installing a partial summary", async () => {
    let entered!: () => void; const waiting = new Promise<void>((resolve) => { entered = resolve; });
    let compactSignal: AbortSignal | undefined; let steps = 0;
    const { runtime, run, start } = setup({ async *stream(request) {
      if (request.purpose === "compaction") {
        compactSignal = request.signal; entered();
        yield { type: "assistant_delta", messageId: "partial", delta: "Unfinished handoff" };
        await new Promise(() => {}); return;
      }
      yield call(`work-${++steps}`);
    } }, { contextWindow: smallWindow });
    runtime.registerTool({ name: "test.work", origin: "plugin", handler: () => ({ evidence: "x".repeat(3_000) }) });
    const work = start(); await waiting; runtime.cancelRun(run.id);
    await expect(work).rejects.toThrow();
    expect(compactSignal?.aborted).toBe(true);
    expect(runtime.getCheckpoint(run.id)?.compactions).toBe(0);
    expect(runtime.getCheckpoint(run.id)?.prompt.conversation.some((message) => message.role === "tool")).toBe(true);
    expect(runtime.getEvents(run.id).some((event) => event.type === "context.compacted")).toBe(false);
  });

  it("preserves history when persistence rejects the replacement and never reports completion", async () => {
    class FailingStore extends MemoryHarnessCheckpointStore {
      override save(checkpoint: Parameters<MemoryHarnessCheckpointStore["save"]>[0]) {
        if (checkpoint.compactions > 0) throw new Error("disk unavailable");
        super.save(checkpoint);
      }
    }
    let steps = 0;
    const { runtime, run, start } = setup({ async *stream(request) {
      if (request.purpose === "compaction") {
        yield { type: "assistant_delta", messageId: "summary", delta: "Progress verified; keep all requirements." };
        yield { type: "final", output: {} }; return;
      }
      yield call(`work-${++steps}`);
    } }, { contextWindow: smallWindow, checkpointStore: new FailingStore() });
    runtime.registerTool({ name: "test.work", origin: "plugin", handler: () => ({ evidence: "x".repeat(3_000) }) });
    await expect(start()).rejects.toThrow("disk unavailable");
    expect(runtime.getCheckpoint(run.id)?.compactions).toBe(0);
    expect(runtime.getCheckpoint(run.id)?.prompt.conversation.some((message) => message.role === "tool")).toBe(true);
    expect(runtime.getEvents(run.id).filter((event) => event.type === "run.failed")).toHaveLength(1);
  });

  it("cancels a completion check that ignores its signal", async () => {
    let entered!: () => void; const waiting = new Promise<void>((resolve) => { entered = resolve; });
    const { runtime, run, start } = setup({ async *stream() { yield { type: "final", output: {} }; } }, {
      completionCheck: () => { entered(); return new Promise(() => {}); },
    });
    const work = start(); await waiting; runtime.cancelRun(run.id); await expect(work).rejects.toThrow();
    expect(runtime.getRun(run.id).status).toBe("canceled");
    expect(runtime.getEvents(run.id).some((event) => event.type === "run.completed")).toBe(false);
  });

  it("returns a denial to the model without executing the tool or reviving a canceled request", async () => {
    let steps = 0; let final: HarnessModelRequest | undefined;
    const { runtime, run, start } = setup({ async *stream(request) {
      if (steps++ === 0) yield call("protected");
      else { final = request; yield { type: "final", output: {} }; }
    } });
    const handler = vi.fn();
    runtime.registerTool({ name: "test.work", origin: "plugin", handler, requiresPermission: () => ({
      kind: "filesystem.read", reason: "Read", scope: { uri: "file:///protected", access: "read" },
    }) });
    const work = start();
    await vi.waitFor(() => expect(runtime.getRun(run.id).status).toBe("awaiting_permission"));
    const event = runtime.getEvents(run.id).find((item) => item.type === "permission.requested");
    if (event?.type !== "permission.requested") throw new Error("missing request");
    runtime.resolvePermission({ requestId: event.request.id, status: "denied" }); await work;
    expect(handler).not.toHaveBeenCalled();
    expect(final!.prompt.conversation).toContainEqual(expect.objectContaining({ role: "tool", content: expect.stringContaining("permission was denied") }));
    expect(() => runtime.resolvePermission({ requestId: event.request.id, status: "approved" })).toThrow();
  });

  it("rejects a truncated model response before invoking its tools", async () => {
    const { runtime, run, start } = setup({ async *stream() {
      yield call("truncated"); yield { type: "final", incomplete: true, output: {} };
    } });
    const handler = vi.fn(); runtime.registerTool({ name: "test.work", origin: "plugin", handler });
    await expect(start()).rejects.toThrow("cut short");
    expect(handler).not.toHaveBeenCalled();
    expect(runtime.getCheckpoint(run.id)?.pending_tool_calls[0].id).toBe("truncated");
    expect(runtime.getRun(run.id).status).toBe("failed");
  });

  it("accounts for context removed by fresh steering instead of compacting a stale large prefix", async () => {
    let steps = 0;
    const { runtime, run } = setup({ async *stream(request) {
      expect(request.purpose).toBe("response");
      if (steps++ === 0) runtime.enqueueUserInput(run.id, { id: "refresh", messages: [{ role: "user", content: "Use the smaller current source" }],
        contextual: [{ slot: "contextual", source: "large", content: "Current smaller source" }] });
      yield { type: "final", output: {}, usage: { inputTokens: steps === 1 ? 4_500 : 600, totalTokens: 4_501 } };
    } }, { contextWindow: smallWindow });
    await runtime.runAgentTurn({ runId: run.id, agentId: "test.agent", messages: [], prompt: {
      developer: [], contextual: [{ slot: "contextual", source: "large", content: "x".repeat(6_000) }],
      conversation: [{ role: "user", content: "Read current source" }],
    } });
    expect(steps).toBe(2);
  });

  it("accounts provider input and output usage when totalTokens is omitted", async () => {
    let requests = 0;
    const { runtime, run, start } = setup({ async *stream() {
      requests += 1; yield call("work"); yield { type: "final", output: {}, usage: { inputTokens: 950, outputTokens: 75 } };
    } }, { limits: { maxTotalTokens: 1_000 } });
    runtime.registerTool({ name: "test.work", origin: "plugin", handler: () => ({ evidence: "saved" }) });
    await expect(start()).rejects.toThrow("execution budget");
    expect(requests).toBe(1);
    expect(runtime.getCheckpoint(run.id)?.tokens_used).toBe(1_025);
  });
});
