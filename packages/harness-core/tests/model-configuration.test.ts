import { describe, expect, it } from "vitest";
import { createHarnessRuntime, type HarnessModelConfiguration, type HarnessModelRequest, type HarnessRuntime } from "../src";

const policy = { scope_ids: ["test"] };
function register(runtime: HarnessRuntime) {
  runtime.registerPlugin({ id: "test", name: "Test", version: "1", module_format: "esm", scopes: ["test"],
    agents: [{ id: "agent", name: "Agent", role: "primary", allowed_tool_names: ["test.wait"] }] });
}
function configuration(effort: "low" | "high"): HarnessModelConfiguration {
  return { modelOptions: { reasoningEffort: effort }, modelConfigurationKey: `model:${effort}`,
    contextWindow: { maxInputTokens: 20_000, compactAtRatio: 0.8, modelContextTokens: 100_000,
      reservedOutputTokens: effort === "low" ? 1_000 : 4_000, growthHeadroomTokens: 512 } };
}

describe("model configuration refresh", () => {
  it.each([false, true])("refreshes the next step after a tool wait; changed=%s", async (changed) => {
    let effort: "low" | "high" = "low";
    let entered!: () => void; const waiting = new Promise<void>((resolve) => { entered = resolve; });
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
    const requests: HarnessModelRequest[] = [];
    let refreshes = 0;
    const runtime = createHarnessRuntime({ model: { async *stream(request) {
      requests.push(request);
      if (requests.length === 1) yield { type: "tool_call", call: { id: "wait", name: "test.wait", origin: "plugin", input: {} } };
      yield { type: "final", output: {}, usage: { inputTokens: 600, outputTokens: 10 } };
    } } });
    register(runtime);
    runtime.registerTool({ name: "test.wait", origin: "plugin", handler: async () => { entered(); await gate; return { evidence: "verified" }; } });
    const run = runtime.createRun({ user_message: "verify", capability_policy: policy });
    const work = runtime.runAgentTurn({ runId: run.id, agentId: "agent", model: "model", messages: [{ role: "user", content: "verify" }],
      resolveModelConfiguration: async () => { refreshes += 1; return configuration(effort); } });
    await waiting;
    if (changed) effort = "high";
    release(); await work;
    expect(refreshes).toBe(2);
    expect(requests[0]).toMatchObject({ modelOptions: { reasoningEffort: "low" }, maxOutputTokens: 1_000 });
    expect(requests[1]).toMatchObject({ modelOptions: { reasoningEffort: changed ? "high" : "low" }, maxOutputTokens: changed ? 4_000 : 1_000 });
    expect(requests[1].prompt.conversation.slice(0, requests[0].prompt.conversation.length)).toEqual(requests[0].prompt.conversation);
    expect(runtime.getEvents(run.id).filter((event) => event.type === "model.call.started")[1]).toMatchObject({ input_calibrated: !changed });
    const saved = runtime.getCheckpoint(run.id)!;
    expect(saved.model_options).toEqual({ reasoningEffort: changed ? "high" : "low" });
    expect(saved.context_window?.reservedOutputTokens).toBe(changed ? 4_000 : 1_000);
    expect(saved).not.toHaveProperty("resolveModelConfiguration");
  });

  it("keeps completed tool evidence and the last configuration when refreshing fails", async () => {
    let refreshes = 0; let calls = 0;
    const runtime = createHarnessRuntime({ model: { async *stream() {
      calls += 1;
      yield { type: "tool_call", call: { id: "work", name: "test.wait", origin: "plugin", input: {} } };
      yield { type: "final", output: {}, usage: { inputTokens: 600, outputTokens: 10 } };
    } } });
    register(runtime);
    runtime.registerTool({ name: "test.wait", origin: "plugin", handler: () => ({ evidence: "persisted" }) });
    const run = runtime.createRun({ user_message: "verify", capability_policy: policy });
    await expect(runtime.runAgentTurn({ runId: run.id, agentId: "agent", messages: [{ role: "user", content: "verify" }],
      resolveModelConfiguration: () => { if (refreshes++ > 0) throw new Error("configuration unavailable"); return configuration("low"); },
    })).rejects.toThrow("configuration unavailable");
    expect(calls).toBe(1);
    const saved = runtime.getCheckpoint(run.id)!;
    expect(saved.prompt.conversation).toContainEqual(expect.objectContaining({ role: "tool", toolCallId: "work", content: expect.stringContaining("persisted") }));
    expect(saved.model_options).toEqual({ reasoningEffort: "low" });
    expect(saved.context_window?.reservedOutputTokens).toBe(1_000);
    expect(runtime.getRun(run.id).status).toBe("failed");
  });

  it("cancels a configuration resolver that ignores cancellation and does not issue a model request", async () => {
    let entered!: () => void; const waiting = new Promise<void>((resolve) => { entered = resolve; });
    let release!: (value: HarnessModelConfiguration) => void;
    const gate = new Promise<HarnessModelConfiguration>((resolve) => { release = resolve; });
    let requests = 0;
    const runtime = createHarnessRuntime({ model: { async *stream() { requests += 1; yield { type: "final", output: {} }; } } }); register(runtime);
    const run = runtime.createRun({ user_message: "verify", capability_policy: policy });
    const work = runtime.runAgentTurn({ runId: run.id, agentId: "agent", messages: [{ role: "user", content: "verify" }],
      resolveModelConfiguration: () => { entered(); return gate; } });
    await waiting;
    runtime.cancelRun(run.id);
    await expect(work).rejects.toThrow();
    release(configuration("high")); await Promise.resolve();
    expect(requests).toBe(0);
    expect(runtime.getRun(run.id).status).toBe("canceled");
    expect(runtime.getCheckpoint(run.id)?.model_options).toBeUndefined();
  });

  it("resolves each parallel run independently and preserves run-specific budget fields in a partial refresh", async () => {
    const requests: HarnessModelRequest[] = [];
    const runtime = createHarnessRuntime({ model: { async *stream(request) { requests.push(request); yield { type: "final", output: {} }; } } }); register(runtime);
    const first = runtime.createRun({ user_message: "one", capability_policy: policy });
    const second = runtime.createRun({ user_message: "two", capability_policy: policy });
    await Promise.all([
      runtime.runAgentTurn({ runId: first.id, agentId: "agent", messages: [{ role: "user", content: "one" }],
        contextWindow: { maxInputTokens: 30_000, summaryTokens: 700 },
        resolveModelConfiguration: () => ({ modelOptions: { reasoningEffort: "low" }, contextWindow: { reservedOutputTokens: 1_000 } }) }),
      runtime.runAgentTurn({ runId: second.id, agentId: "agent", messages: [{ role: "user", content: "two" }], resolveModelConfiguration: () => configuration("high") }),
    ]);
    expect(requests.find((request) => request.runId === first.id)).toMatchObject({ modelOptions: { reasoningEffort: "low" }, maxOutputTokens: 1_000 });
    expect(requests.find((request) => request.runId === second.id)).toMatchObject({ modelOptions: { reasoningEffort: "high" }, maxOutputTokens: 4_000 });
    expect(runtime.getCheckpoint(first.id)?.context_window).toMatchObject({ maxInputTokens: 30_000, summaryTokens: 700 });
    expect(runtime.getCheckpoint(second.id)?.context_window).toMatchObject({ maxInputTokens: 20_000, summaryTokens: 4_096 });
  });
});
