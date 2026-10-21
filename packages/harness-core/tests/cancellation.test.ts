import { describe, expect, it, vi } from "vitest";
import { createHarnessRuntime, type HarnessModelAdapter } from "../src";

function deferred() { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r; }); return { promise, resolve }; }
function setup(model: HarnessModelAdapter) {
  const runtime = createHarnessRuntime({ model });
  runtime.registerPlugin({ id: "test", name: "Test", version: "1", module_format: "esm", scopes: ["test"], agents: [{ id: "test.agent", name: "Test", role: "primary", allowed_tool_names: ["test.tool"] }] });
  const run = runtime.createRun({ capability_policy: { plugin_ids: ["test"] }, user_message: "test" });
  return { runtime, run, execute: () => runtime.runAgentTurn({ runId: run.id, agentId: "test.agent", messages: [] }) };
}

describe("run cancellation", () => {
  it("cancels a blocked model promptly and never executes its later tool call", async () => {
    const ready = deferred(); const release = deferred();
    let signal: AbortSignal | undefined;
    const { runtime, run, execute } = setup({ async *stream(request) {
      signal = request.signal; ready.resolve(); await release.promise;
      yield { type: "tool_call", call: { id: "call", name: "test.tool", origin: "plugin", input: {} } };
    } });
    const handler = vi.fn(() => ({})); runtime.registerTool({ name: "test.tool", origin: "plugin", handler });
    const pending = execute(); const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await ready.promise; runtime.cancelRun(run.id); await rejected;
    expect(signal?.aborted).toBe(true);
    release.resolve(); await Promise.resolve();
    expect(handler).not.toHaveBeenCalled();
    expect(runtime.getRun(run.id).status).toBe("canceled");
    expect(runtime.getEvents(run.id).map((event) => event.type)).toEqual(["run.started", "run.canceled"]);
  });

  it("propagates cancellation to a running tool and starts no subsequent calls", async () => {
    const ready = deferred(); const release = deferred(); let toolSignal: AbortSignal | undefined;
    const model = { stream: vi.fn(async function* () {
      yield { type: "tool_call" as const, call: { id: "one", name: "test.tool", origin: "plugin" as const, input: {} } };
      yield { type: "tool_call" as const, call: { id: "two", name: "test.tool", origin: "plugin" as const, input: {} } };
    }) };
    const { runtime, run, execute } = setup(model);
    const handler = vi.fn(async (_input, _call, context) => { toolSignal = context.signal; ready.resolve(); await release.promise; return { applied: true }; });
    runtime.registerTool({ name: "test.tool", origin: "plugin", handler });
    const pending = execute(); const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await ready.promise; runtime.cancelRun(run.id); expect(toolSignal?.aborted).toBe(true);
    release.resolve(); await rejected;
    expect(handler).toHaveBeenCalledOnce(); expect(model.stream).toHaveBeenCalledOnce();
    expect(runtime.getRun(run.id).status).toBe("canceled");
  });

  it("keeps one immutable terminal event and rejects attempts to reopen the run", () => {
    const { runtime, run } = setup({ async *stream() {} });
    const canceled = runtime.cancelRun(run.id);
    expect(runtime.cancelRun(run.id)).toBe(canceled);
    expect(runtime.completeRun(run.id)).toBe(canceled);
    expect(runtime.failRun(run.id, { code: "late", message: "late" })).toBe(canceled);
    expect(() => runtime.recordUserInput(run.id, {})).toThrow("Invalid run transition");
    expect(runtime.getEvents(run.id)).toHaveLength(2);
  });
});
