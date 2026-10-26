import { describe, expect, it } from "vitest";
import { modelRuntimeConfiguration } from "../src/model-catalog";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHarnessRuntime, type HarnessModelRequest } from "@typedance/harness-core";
import { createAgentHost, createSqliteAgentHostStore, JsonFileHarnessCheckpointStore } from "../src/index";

describe("run model configuration", () => {
  it("separates the known model capacity from the product budget and reserves the effective output", () => {
    expect(modelRuntimeConfiguration("deepseek-flash", "off").contextWindow).toEqual({
      maxInputTokens: 160_000, compactAtRatio: 0.8, modelContextTokens: 1_048_576,
      reservedOutputTokens: 8_192, growthHeadroomTokens: 8_192,
    });
    expect(modelRuntimeConfiguration("deepseek-v4-pro", "high").contextWindow?.reservedOutputTokens).toBe(65_536);
    expect(modelRuntimeConfiguration("deepseek-flash", "max").contextWindow?.reservedOutputTokens).toBe(131_072);
    expect(modelRuntimeConfiguration("custom-model").contextWindow).toMatchObject({ maxInputTokens: 64_000 });
    expect(modelRuntimeConfiguration("custom-model").contextWindow).not.toHaveProperty("modelContextTokens");
  });

  it("binds measurement reuse to the effective model, reasoning mode and normalized provider endpoint", () => {
    const original = modelRuntimeConfiguration("deepseek-flash", "low", "https://api.deepseek.com/");
    expect(original).toEqual(modelRuntimeConfiguration("deepseek-flash", "low", "https://api.deepseek.com"));
    for (const changed of [
      modelRuntimeConfiguration("deepseek-v4-pro", "low"),
      modelRuntimeConfiguration("deepseek-flash", "off"),
      modelRuntimeConfiguration("deepseek-flash", "low", "https://gateway.example/v1"),
    ]) expect(changed.modelConfigurationKey).not.toBe(original.modelConfigurationKey);
    expect(original.modelOptions).toEqual({ reasoningEffort: "low", providerBaseUrl: "https://api.deepseek.com" });
  });

  it("restores a measured prefix through a disk restart and invalidates it when the saved run mode changes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "typedance-input-measurement-"));
    let effort: "off" | "high" = "off";
    const requests: HarnessModelRequest[] = [];
    function open() {
      const runtime = createHarnessRuntime({ checkpointStore: new JsonFileHarnessCheckpointStore(join(directory, "checkpoints")), model: {
        async *stream(request) { requests.push(request); yield { type: "assistant_delta", messageId: "a", delta: "已核对" };
          yield { type: "final", output: {}, usage: { inputTokens: 100, outputTokens: 4, cacheReadInputTokens: 80 } }; },
      } });
      runtime.registerPlugin({ id: "test", name: "Test", version: "1", module_format: "esm", scopes: ["test"], agents: [{ id: "test.agent", name: "Test", role: "primary", allowed_tool_names: [] }] });
      const store = createSqliteAgentHostStore(join(directory, "store.sqlite"));
      const host = createAgentHost({ runtime, store, defaultModel: "deepseek-flash",
        resolveModelRuntimeConfiguration: (model) => modelRuntimeConfiguration(model!, effort),
        packs: [{ id: "resume", primaryAgentId: "test.agent", capabilityPolicy: { pluginIds: ["test"] } }],
      });
      return { runtime, host, store };
    }
    let instance = open();
    try {
      const conversation = instance.host.createConversation("ws");
      const first = instance.host.startConversationRun("ws", conversation.id, { message: { content: "资料".repeat(200) } });
      await instance.host.waitForRun(first.id);
      expect(instance.host.getAgentRun(first.id).status).toBe("completed");
      instance.store.close();
      instance = open();
      const second = instance.host.startConversationRun("ws", conversation.id, { message: { content: "继续核对" } });
      await instance.host.waitForRun(second.id);
      const started = instance.host.listAgentRunEvents(second.id).map((event) => event.payload.event)
        .find((event) => (event as { type?: string } | undefined)?.type === "model.call.started");
      expect(started).toMatchObject({ input_calibrated: true, budget_tokens: 160_000 });
      expect(requests.at(-1)).toMatchObject({ modelOptions: { reasoningEffort: "off" }, maxOutputTokens: 8192 });
      effort = "high";
      const third = instance.host.startConversationRun("ws", conversation.id, { message: { content: "再次核对" } });
      await instance.host.waitForRun(third.id);
      const changed = instance.host.listAgentRunEvents(third.id).map((event) => event.payload.event)
        .find((event) => (event as { type?: string } | undefined)?.type === "model.call.started");
      expect(changed).toMatchObject({ input_calibrated: false });
      expect(requests.at(-1)).toMatchObject({ modelOptions: { reasoningEffort: "high" }, maxOutputTokens: 65_536 });
    } finally {
      instance.store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
