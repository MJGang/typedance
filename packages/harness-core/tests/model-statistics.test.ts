import { describe, expect, it, vi } from "vitest";
import { createHarnessRuntime, type HarnessModelRequest } from "../src";

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
});
