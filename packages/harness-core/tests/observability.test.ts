import { describe, expect, it } from "vitest";
import { createHarnessRuntime, type HarnessRuntimeObserver } from "../src";

function runtimeWith(observer: HarnessRuntimeObserver, fail = false) {
  const runtime = createHarnessRuntime({ observer, model: { async *stream() {
    yield { type: "assistant_delta", messageId: "m", delta: "hello" };
    if (fail) throw new Error("provider unavailable");
    yield { type: "final", output: { ok: true } };
  } } });
  runtime.registerPlugin({ id: "test", name: "Test", version: "1", module_format: "esm", scopes: ["test"], agents: [{ id: "agent", name: "Agent", role: "primary" }] });
  const run = runtime.createRun({ user_message: "hello", context: {}, capability_policy: { plugin_ids: ["test"], scope_ids: [] } });
  return { runtime, run, execute: () => runtime.runAgentTurn({ runId: run.id, agentId: "agent", messages: [{ role: "user", content: "hello" }] }) };
}

describe("runtime observability isolation", () => {
  it("preserves agent output when every observer callback throws", async () => {
    const fail = () => { throw new Error("telemetry failure"); };
    const { runtime, run, execute } = runtimeWith({ onRunEvent: fail, onModelStart: () => ({ onEvent: fail, end: fail }) });
    await expect(execute()).resolves.toEqual({ ok: true });
    expect(runtime.getRun(run.id).status).toBe("completed");
    expect(runtime.getEvents(run.id).map((event) => event.type)).toEqual(["run.started", "model.call.started", "model.call.progress", "assistant.delta", "model.call.completed", "run.completed"]);
    const failingStart = runtimeWith({ onModelStart: fail });
    await expect(failingStart.execute()).resolves.toEqual({ ok: true });
  });

  it("ends model observations once with the actual provider error", async () => {
    const ends: { error?: unknown; canceled: boolean }[] = [];
    const { runtime, run, execute } = runtimeWith({ onModelStart: () => ({ end: (result) => { ends.push(result); } }) }, true);
    await expect(execute()).rejects.toThrow("provider unavailable");
    expect(runtime.getRun(run.id).status).toBe("failed");
    expect(ends).toHaveLength(1);
    expect(ends[0].error).toBeInstanceOf(Error);
    expect(ends[0].canceled).toBe(false);
  });
});
