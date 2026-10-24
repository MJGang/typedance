import { describe, expect, it, vi } from "vitest";
import { createHarnessRuntime, type HarnessModelAdapter, type HarnessModelRequest } from "../src";

function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
function setup(model: HarnessModelAdapter) {
  const runtime = createHarnessRuntime({ model });
  runtime.registerPlugin({ id: "test", name: "Test", version: "1", module_format: "esm", scopes: ["test"],
    agents: [{ id: "test.agent", name: "Test", role: "primary", allowed_tool_names: ["test.tool"] }] });
  const run = runtime.createRun({ capability_policy: { scope_ids: ["test"] }, user_message: "start" });
  const start = () => runtime.runAgentTurn({ runId: run.id, agentId: "test.agent", messages: [{ role: "user", content: "start" }] });
  return { runtime, run, start };
}

describe("active run steering", () => {
  it("consumes input accepted during streaming before completing, preserving response boundaries and FIFO", async () => {
    const entered = deferred(); const release = deferred(); const requests: HarnessModelRequest[] = [];
    const { runtime, run, start } = setup({ async *stream(request) {
      requests.push(request);
      yield { type: "assistant_delta", messageId: "same-provider-id", delta: requests.length === 1 ? "checking" : "updated answer" };
      if (requests.length === 1) { entered.resolve(); await release.promise; }
      yield { type: "final", output: {} };
    } });
    const work = start(); await entered.promise;
    runtime.enqueueUserInput(run.id, { id: "one", messages: [{ role: "user", content: "first follow-up" }] });
    runtime.enqueueUserInput(run.id, { id: "two", messages: [{ role: "user", content: "second follow-up" }] });
    release.resolve(); await work;
    expect(requests).toHaveLength(2);
    expect(requests[1].prompt.conversation).toEqual([
      { role: "user", content: "start" }, { role: "assistant", content: "checking" },
      { role: "user", content: "first follow-up" }, { role: "user", content: "second follow-up" },
    ]);
    const deltas = runtime.getEvents(run.id).filter((event) => event.type === "assistant.delta");
    expect(new Set(deltas.map((event) => event.message_id)).size).toBe(2);
    expect(runtime.getEvents(run.id).filter((event) => event.type === "user.input.applied").map((event) => event.input_id)).toEqual(["one", "two"]);
    expect(runtime.getRun(run.id).status).toBe("completed");
  });

  it("finishes an active tool but skips unstarted tools when instructions change", async () => {
    const entered = deferred(); const release = deferred(); const requests: HarnessModelRequest[] = [];
    const { runtime, run, start } = setup({ async *stream(request) {
      requests.push(request);
      if (requests.length === 1) {
        for (const id of ["one", "two"]) yield { type: "tool_call", call: { id, name: "test.tool", origin: "plugin", input: {} } };
      } else yield { type: "assistant_delta", messageId: "answer", delta: "obeying the new instruction" };
    } });
    const handler = vi.fn(async () => { entered.resolve(); await release.promise; return { done: true }; });
    runtime.registerTool({ name: "test.tool", origin: "plugin", handler });
    const work = start(); await entered.promise;
    runtime.enqueueUserInput(run.id, { id: "stop-writing", messages: [{ role: "user", content: "do not execute the second action" }] });
    release.resolve(); await work;
    expect(handler).toHaveBeenCalledTimes(1);
    expect(requests[1].prompt.conversation.filter((message) => message.role === "tool")).toHaveLength(2);
    expect(requests[1].prompt.conversation[3]).toMatchObject({ role: "tool", toolCallId: "two", content: expect.stringContaining("not executed") });
    expect(requests[1].prompt.conversation[4]).toEqual({ role: "user", content: "do not execute the second action" });
  });

  it("refreshes contextual sources and applies input accepted before the first model call", async () => {
    let seen: HarnessModelRequest | undefined;
    const { runtime, run } = setup({ async *stream(request) { seen = request; yield { type: "final", output: {} }; } });
    runtime.enqueueUserInput(run.id, { id: "new-context", messages: [{ role: "user", content: "use the updated document" }],
      contextual: [{ slot: "contextual", source: "document", content: "new snapshot" }] });
    await runtime.runAgentTurn({ runId: run.id, agentId: "test.agent", messages: [], prompt: {
      developer: [], contextual: [{ slot: "contextual", source: "document", content: "old snapshot" }], conversation: [{ role: "user", content: "start" }],
    } });
    expect(seen!.prompt.contextual).toEqual([{ slot: "contextual", source: "document", content: "new snapshot" }]);
    expect(seen!.prompt.conversation).toHaveLength(2);
  });

  it("never revives a canceled run or lets queued input leak into another run", async () => {
    const { runtime, run } = setup({ async *stream() { yield { type: "final", output: {} }; } });
    runtime.enqueueUserInput(run.id, { id: "queued", messages: [{ role: "user", content: "follow-up" }] });
    runtime.cancelRun(run.id);
    const count = runtime.getEvents(run.id).length;
    expect(() => runtime.enqueueUserInput(run.id, { id: "late", messages: [{ role: "user", content: "late" }] })).toThrow();
    expect(() => runtime.recordUserInput(run.id, {})).toThrow();
    expect(runtime.getEvents(run.id)).toHaveLength(count);
    expect(runtime.getEvents(run.id).some((event) => event.type === "user.input.applied")).toBe(false);
  });

  it("gives input accepted on the last allowed step a fresh model budget without reusing response ids", async () => {
    let passes = 0;
    const { runtime, run, start } = setup({ async *stream() {
      passes += 1;
      if (passes === 8) runtime.enqueueUserInput(run.id, { id: "last-step", messages: [{ role: "user", content: "use this new requirement" }] });
      if (passes <= 8) yield { type: "tool_call", call: { id: `tool-${passes}`, name: "test.tool", origin: "plugin", input: {} } };
      else yield { type: "assistant_delta", messageId: "answer", delta: "done" };
    } });
    runtime.registerTool({ name: "test.tool", origin: "plugin", handler: async () => ({}) });
    await start();
    expect(passes).toBe(9);
    expect(runtime.getRun(run.id).status).toBe("completed");
    expect(runtime.getEvents(run.id)).toContainEqual(expect.objectContaining({ type: "assistant.delta", message_id: "8:answer" }));
  });
});
