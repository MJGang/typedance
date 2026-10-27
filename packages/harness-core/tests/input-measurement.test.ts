import { describe, expect, it } from "vitest";
import { MemoryHarnessCheckpointStore, createHarnessRuntime, estimatePromptTokens, measureInputTokens, predictInputTokens, restoreCheckpointHistory,
  type HarnessModelRequest, type HarnessPromptBundle, type HarnessModelTool } from "../src";

const prompt = (): HarnessPromptBundle => ({ developer: [{ slot: "developer", source: "rules", content: "固定规则".repeat(400) }],
  contextual: [], conversation: [{ role: "user", content: "开始" }] });
const tools: HarnessModelTool[] = [{ name: "read", origin: "plugin", description: "Read", inputSchema: { type: "object", properties: {} } }];

describe("provider input measurement", () => {
  it("uses actual input for the unchanged prefix and estimates only newly appended evidence", () => {
    const base = { model: "model", modelOptions: { reasoningEffort: "low" }, modelConfigurationKey: "route-a", prompt: prompt(), tools };
    const measured = measureInputTokens(base, 800);
    const next = structuredClone(base);
    next.prompt.conversation.push({ role: "assistant", content: "", reasoningContent: "核验".repeat(20),
      toolCalls: [{ id: "read-1", name: "read", origin: "plugin", input: {} }] },
    { role: "tool", toolCallId: "read-1", toolName: "read", content: "新增资料".repeat(40) });
    expect(predictInputTokens(next, measured)).toEqual({ calibrated: true, estimatedTokens: estimatePromptTokens(next.prompt, tools),
      tokens: 800 + estimatePromptTokens(next.prompt, tools) - measured.estimated_tokens });
    expect(predictInputTokens(next, measured).tokens).toBeLessThan(estimatePromptTokens(next.prompt, tools));
  });

  it.each(["model", "effort", "route", "tools", "system", "prefix", "removed"])("invalidates a measurement after %s changes", (change) => {
    const base = { model: "model", modelOptions: { reasoningEffort: "low" }, modelConfigurationKey: "route-a", prompt: prompt(), tools };
    const measured = measureInputTokens(base, 800);
    const next = structuredClone(base);
    if (change === "model") next.model = "other";
    if (change === "effort") next.modelOptions.reasoningEffort = "high";
    if (change === "route") next.modelConfigurationKey = "route-b";
    if (change === "tools") next.tools[0].description = "Changed schema instructions";
    if (change === "system") next.prompt.developer[0].content += "new rule";
    if (change === "prefix") next.prompt.conversation[0].content = "replacement";
    if (change === "removed") next.prompt.conversation = [];
    expect(predictInputTokens(next, measured)).toEqual({ calibrated: false, estimatedTokens: estimatePromptTokens(next.prompt, next.tools),
      tokens: estimatePromptTokens(next.prompt, next.tools) });
  });

  it("keeps opaque tool argument and schema key order significant while normalizing checkpoint field order", () => {
    const base = { model: "model", prompt: prompt(), tools: structuredClone(tools) };
    base.prompt.conversation.push({ role: "assistant", content: "", toolCalls: [{ id: "read-1", name: "read", origin: "plugin", input: { first: 1, second: 2 } }] });
    const measured = measureInputTokens(base, 800);
    const next = structuredClone(base);
    const assistant = next.prompt.conversation[1];
    if (assistant.role !== "assistant") throw new Error("missing assistant");
    assistant.toolCalls![0].input = { second: 2, first: 1 };
    expect(predictInputTokens(next, measured).calibrated).toBe(false);
    const changedSchema = structuredClone(base);
    changedSchema.tools[0].inputSchema = { properties: {}, type: "object" };
    expect(predictInputTokens(changedSchema, measured).calibrated).toBe(false);
  });
});

const policy = { scope_ids: ["test"] };
function register(runtime: ReturnType<typeof createHarnessRuntime>) {
  runtime.registerPlugin({ id: "test", name: "Test", version: "1", module_format: "esm", scopes: ["test"],
    agents: [{ id: "agent", name: "Agent", role: "primary", allowed_tool_names: ["test.read"] }] });
}
const window = { maxInputTokens: 6_000, compactAtRatio: 0.6, retainedUserTokens: 500, summaryTokens: 300 };
const rules = { slot: "developer" as const, source: "rules", content: "当前资料".repeat(200) };

describe("run-bound context accounting", () => {
  it("does not compact a measured Chinese prefix merely because the rough estimate grows past the threshold", async () => {
    const requests: HarnessModelRequest[] = [];
    const runtime = createHarnessRuntime({ contextWindow: window, model: { async *stream(request) {
      requests.push(request);
      if (requests.length === 1) yield { type: "tool_call", call: { id: "read", name: "test.read", origin: "plugin", input: {} } };
      yield { type: "final", output: {}, usage: { inputTokens: requests.length === 1 ? 600 : 1_900, outputTokens: 10 } };
    } } });
    register(runtime);
    runtime.registerTool({ name: "test.read", origin: "plugin", handler: () => ({ text: "新增内容".repeat(200) }) });
    const run = runtime.createRun({ user_message: "核验", capability_policy: policy });
    await runtime.runAgentTurn({ runId: run.id, agentId: "agent", model: "model", messages: [],
      prompt: { developer: [rules], contextual: [], conversation: [{ role: "user", content: "核验" }] } });
    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.purpose === "response")).toBe(true);
    const started = runtime.getEvents(run.id).filter((event) => event.type === "model.call.started");
    expect(started[1]).toMatchObject({ input_calibrated: true });
    if (started[1].type !== "model.call.started") throw new Error("missing call");
    expect(started[1].input_tokens).toBeGreaterThan(window.maxInputTokens * window.compactAtRatio);
    expect(started[1].predicted_input_tokens).toBeLessThan(window.maxInputTokens * window.compactAtRatio);
  });

  it.each(["history", "resume"])("restores the measured prefix through %s in a new runtime before its first request", async (mode) => {
    const checkpointStore = new MemoryHarnessCheckpointStore();
    const requests: HarnessModelRequest[] = [];
    const model = { async *stream(request: HarnessModelRequest) {
      requests.push(request);
      yield { type: "assistant_delta" as const, messageId: "answer", delta: "已核验" };
      yield { type: "final" as const, output: {}, usage: { inputTokens: 600, outputTokens: 10 } };
    } };
    const initial = createHarnessRuntime({ contextWindow: window, checkpointStore, model }); register(initial);
    const run = initial.createRun({ user_message: "初始请求", capability_policy: policy });
    await initial.runAgentTurn({ runId: run.id, agentId: "agent", model: "model", modelConfigurationKey: "route", messages: [],
      prompt: { developer: [rules], contextual: [], conversation: [{ role: "user", content: "初始请求" }] } });
    const saved = checkpointStore.load(run.id)!;
    const history = restoreCheckpointHistory(saved);
    const next = createHarnessRuntime({ contextWindow: window, checkpointStore, model }); register(next);
    const resumed = next.createRun({ user_message: "继续", capability_policy: policy });
    const followup = { role: "user" as const, content: "新输入".repeat(220) };
    await next.runAgentTurn({ runId: resumed.id, agentId: "agent", model: "model", modelConfigurationKey: "route", messages: [],
      ...(mode === "resume" ? { resumeFromRunId: run.id } : { inputMeasurement: history.inputMeasurement, historyInputIds: history.inputIds }),
      prompt: { developer: [rules], contextual: [], conversation: [...(mode === "history" ? history.messages : []), followup] } });
    expect(requests).toHaveLength(2);
    expect(requests[1].purpose).toBe("response");
    expect(next.getEvents(resumed.id).find((event) => event.type === "model.call.started")).toMatchObject({ input_calibrated: true });
    expect(saved.input_measurement?.input_tokens).toBe(600);
  });

  it("snapshots each run's capacity and bounds the provider output without changing another run", async () => {
    const requests: HarnessModelRequest[] = [];
    const runtime = createHarnessRuntime({ model: { async *stream(request) { requests.push(request); yield { type: "final", output: {} }; } } }); register(runtime);
    const first = runtime.createRun({ user_message: "one", capability_policy: policy });
    const second = runtime.createRun({ user_message: "two", capability_policy: policy });
    await Promise.all([
      runtime.runAgentTurn({ runId: first.id, agentId: "agent", messages: [{ role: "user", content: "one" }],
        contextWindow: { maxInputTokens: 20_000, compactAtRatio: 0.8, modelContextTokens: 16_000, reservedOutputTokens: 4_000, growthHeadroomTokens: 2_000 } }),
      runtime.runAgentTurn({ runId: second.id, agentId: "agent", messages: [{ role: "user", content: "two" }] }),
    ]);
    expect(requests.find((request) => request.runId === first.id)?.maxOutputTokens).toBe(4_000);
    expect(requests.find((request) => request.runId === second.id)?.maxOutputTokens).toBeUndefined();
    expect(runtime.getEvents(first.id).find((event) => event.type === "model.call.started")).toMatchObject({ budget_tokens: 12_000 });
    expect(runtime.getEvents(second.id).find((event) => event.type === "model.call.started")).toMatchObject({ budget_tokens: 64_000 });
    expect(runtime.getCheckpoint(first.id)?.context_window).toMatchObject({ reservedOutputTokens: 4_000, modelContextTokens: 16_000 });
  });

  it("checks a compaction request against calibrated input instead of rejecting its larger raw estimate", async () => {
    const requests: HarnessModelRequest[] = [];
    const runtime = createHarnessRuntime({ contextWindow: { maxInputTokens: 7_000, compactAtRatio: 0.6, retainedUserTokens: 500, summaryTokens: 300 },
      model: { async *stream(request) {
        requests.push(request);
        if (request.purpose === "compaction") {
          yield { type: "assistant_delta", messageId: "summary", delta: "已读取资料；继续核验结果。" };
          yield { type: "final", output: {}, usage: { inputTokens: 5_800, outputTokens: 20 } }; return;
        }
        if (requests.length === 1) yield { type: "tool_call", call: { id: "read", name: "test.read", origin: "plugin", input: {} } };
        yield { type: "final", output: {}, usage: { inputTokens: 600, outputTokens: 10 } };
      } } });
    register(runtime);
    runtime.registerTool({ name: "test.read", origin: "plugin", handler: () => ({ text: "新增资料".repeat(650) }) });
    const run = runtime.createRun({ user_message: "核验", capability_policy: policy });
    await runtime.runAgentTurn({ runId: run.id, agentId: "agent", model: "model", messages: [],
      prompt: { developer: [rules], contextual: [], conversation: [{ role: "user", content: "核验" }] } });
    const compaction = requests.find((request) => request.purpose === "compaction");
    expect(compaction).toBeDefined();
    expect(estimatePromptTokens(compaction!.prompt, compaction!.availableTools)).toBeGreaterThan(7_000);
    const started = runtime.getEvents(run.id).find((event) => event.type === "model.call.started" && event.purpose === "compaction");
    expect(started).toMatchObject({ input_calibrated: true });
    if (started?.type !== "model.call.started") throw new Error("missing compaction");
    expect(started.predicted_input_tokens).toBeLessThan(7_000);
    expect(runtime.getCheckpoint(run.id)?.compactions).toBe(1);
    expect(runtime.getEvents(run.id).filter((event) => event.type === "model.call.started").at(-1)).toMatchObject({ input_calibrated: false });
  });
});
