import { describe, expect, it, vi } from "vitest";
import { createHarnessRuntime, estimateTextTokens, type HarnessModelRequest } from "../src";

describe("model call statistics", () => {
  it("records first provider activity, full inclusive usage, and stable generation options", async () => {
    const requests: HarnessModelRequest[] = [];
    const clock = vi.spyOn(performance, "now").mockReturnValueOnce(10).mockReturnValueOnce(110).mockReturnValue(1010);
    try {
      const runtime = createHarnessRuntime({ model: { async *stream(request) {
        requests.push(request);
        yield { type: "first_token" };
        yield { type: "assistant_delta", messageId: "m", delta: "done" };
        yield { type: "final", output: { model: "test-model" }, usage: { inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 80 } };
      } } });
      runtime.registerPlugin({ id: "test", name: "Test", version: "1", module_format: "esm", scopes: ["test"],
        agents: [{ id: "agent", name: "Agent", role: "primary" }] });
      const run = runtime.createRun({ user_message: "hello", capability_policy: { plugin_ids: ["test"], scope_ids: [] } });
      await runtime.runAgentTurn({ runId: run.id, agentId: "agent", model: "test-model", modelOptions: { reasoningEffort: "low" }, messages: [{ role: "user", content: "hello" }] });
      expect(requests[0].modelOptions).toEqual({ reasoningEffort: "low" });
      expect(runtime.getCheckpoint(run.id)?.model_options).toEqual({ reasoningEffort: "low" });
      const started = runtime.getEvents(run.id).find((event) => event.type === "model.call.started");
      const completed = runtime.getEvents(run.id).find((event) => event.type === "model.call.completed");
      expect(started).toMatchObject({ type: "model.call.started", model: "test-model", purpose: "response", budget_tokens: 64000 });
      expect(completed).toMatchObject({ call_id: started && "call_id" in started ? started.call_id : "missing", duration_ms: 1000, ttft_ms: 100,
        status: "completed", usage: { inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 80 } });
    } finally { clock.mockRestore(); }
  });

  it("reports progress during thinking, throttles chunks and flushes the final estimate on transport failure", async () => {
    let now = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    try {
      const runtime = createHarnessRuntime({ model: { async *stream() {
        now = 100; yield { type: "first_token" };
        for (let index = 0; index < 100; index++) { now += 5; yield { type: "reasoning_summary_delta", summaryId: "s", delta: "a" }; }
        now = 1100; yield { type: "reasoning_summary_delta", summaryId: "s", delta: "思考" };
        await gate;
        now = 1200; yield { type: "assistant_delta", messageId: "m", delta: "结束" };
        throw new Error("connection lost");
      } } });
      runtime.registerPlugin({ id: "test", name: "Test", version: "1", module_format: "esm", scopes: ["test"], agents: [{ id: "agent", name: "Agent", role: "primary" }] });
      const run = runtime.createRun({ user_message: "hello", capability_policy: { plugin_ids: ["test"], scope_ids: [] } });
      const work = runtime.runAgentTurn({ runId: run.id, agentId: "agent", messages: [{ role: "user", content: "hello" }] });
      await vi.waitFor(() => expect(runtime.getEvents(run.id).filter((event) => event.type === "model.call.progress")).toHaveLength(2));
      expect(runtime.getEvents(run.id).filter((event) => event.type === "model.call.progress")).toMatchObject([
        { ttft_ms: 100, output_tokens: 0 }, { ttft_ms: 100, output_tokens: 38 },
      ]);
      expect(runtime.getEvents(run.id).some((event) => event.type === "model.call.completed")).toBe(false);
      release();
      await expect(work).rejects.toThrow("connection lost");
      expect(runtime.getEvents(run.id).filter((event) => event.type === "model.call.progress").at(-1)).toMatchObject({ output_tokens: 42 });
      expect(runtime.getEvents(run.id).find((event) => event.type === "model.call.completed")).toMatchObject({ duration_ms: 1200, ttft_ms: 100, status: "failed" });
    } finally { release(); clock.mockRestore(); }
  });

  it("counts streaming tool arguments once and executes the tool only after the complete call arrives", async () => {
    let now = 0; let passes = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const raw = 'test.tool{"value":"' + "a".repeat(300) + '"}';
    const handler = vi.fn(async () => ({}));
    try {
      const runtime = createHarnessRuntime({ model: { async *stream() {
        if (passes++ > 0) { yield { type: "final", output: {} }; return; }
        now = 100; yield { type: "tool_call_delta", callId: "t", delta: raw };
        await gate;
        now = 1200; yield { type: "tool_call", call: { id: "t", name: "test.tool", origin: "plugin", input: { value: "a".repeat(300) } } };
        yield { type: "final", output: {} };
      } } });
      runtime.registerPlugin({ id: "test", name: "Test", version: "1", module_format: "esm", scopes: ["test"], agents: [{ id: "agent", name: "Agent", role: "primary", allowed_tool_names: ["test.tool"] }] });
      runtime.registerTool({ name: "test.tool", origin: "plugin", handler });
      const run = runtime.createRun({ user_message: "hello", capability_policy: { plugin_ids: ["test"], scope_ids: [] } });
      const work = runtime.runAgentTurn({ runId: run.id, agentId: "agent", messages: [{ role: "user", content: "hello" }] });
      await vi.waitFor(() => expect(runtime.getEvents(run.id).some((event) => event.type === "model.call.progress")).toBe(true));
      expect(handler).not.toHaveBeenCalled();
      release(); await work;
      expect(handler).toHaveBeenCalledOnce();
      for (const progress of runtime.getEvents(run.id).filter((event) => event.type === "model.call.progress")) {
        expect(progress).toMatchObject({ output_tokens: estimateTextTokens(raw) });
      }
    } finally { release(); clock.mockRestore(); }
  });
});
