import { describe, expect, it } from "vitest";
import { createHarnessRuntime, MemoryHarnessCheckpointStore, type HarnessModelAdapter, type HarnessModelRequest } from "@typedance/harness-core";
import { createAgentHost, createMemoryAgentHostStore } from "../src";
import { migrateModelHistory } from "../src/migrations/model-history";

const pack = { id: "resume", primaryAgentId: "test.agent", capabilityPolicy: { pluginIds: ["test"] } };
function runtimeWith(model: HarnessModelAdapter, checkpointStore = new MemoryHarnessCheckpointStore()) {
  const runtime = createHarnessRuntime({ model, checkpointStore });
  runtime.registerPlugin({ id: "test", name: "Test", version: "1", module_format: "esm", scopes: ["test"], agents: [{ id: "test.agent", name: "Test", role: "primary", allowed_tool_names: ["test.read"] }] });
  runtime.registerTool({ name: "test.read", origin: "plugin", handler: () => ({ evidence: "only-in-tool-result" }) });
  return runtime;
}

describe("canonical model history", () => {
  it("keeps tool calls and observations across turns and ignores mutable display text", async () => {
    const requests: HarnessModelRequest[] = [];
    const runtime = runtimeWith({ async *stream(request) {
      requests.push(request);
      if (requests.length === 1) yield { type: "tool_call", call: { id: "read", name: "test.read", origin: "plugin", input: {} } };
      else yield { type: "assistant_delta", messageId: "answer", delta: "已查阅" };
      yield { type: "final", output: {} };
    } });
    const host = createAgentHost({ runtime, packs: [pack] }); const conversation = host.createConversation("ws");
    const start = (content: string) => host.startConversationRun("ws", conversation.id, { message: { content } });
    const first = start("先调查"); await host.waitForRun(first.id);
    host.store.updateMessage(first.assistant_message_id!, { content: "display-only-corruption" });
    const second = start("继续"); await host.waitForRun(second.id);
    const history = requests[2].prompt.conversation;
    expect(history).toContainEqual(expect.objectContaining({ role: "assistant", toolCalls: [expect.objectContaining({ id: "read" })] }));
    expect(history).toContainEqual(expect.objectContaining({ role: "tool", toolCallId: "read", content: expect.stringContaining("only-in-tool-result") }));
    expect(JSON.stringify(history)).not.toContain("display-only-corruption");
  });

  it("inherits the compacted prefix after a Host restart without re-expanding the UI transcript", async () => {
    const checkpoints = new MemoryHarnessCheckpointStore();
    const runtime = runtimeWith({ async *stream() { yield { type: "assistant_delta", messageId: "m", delta: "large obsolete transcript" }; yield { type: "final", output: {} }; } }, checkpoints);
    const store = createMemoryAgentHostStore(); const host = createAgentHost({ runtime, store, packs: [pack] });
    const conversation = host.createConversation("ws");
    const first = host.startConversationRun("ws", conversation.id, { message: { content: "原目标" } }); await host.waitForRun(first.id);
    const checkpoint = runtime.getCheckpoint(first.id)!;
    checkpoint.prompt.conversation = [{ role: "user", internal: "compaction", content: "verified-handoff-summary" }]; checkpoint.compactions = 1;
    checkpoints.save(checkpoint);
    let seen: HarnessModelRequest | undefined;
    const restarted = createAgentHost({ store, runtime: runtimeWith({ async *stream(request) { seen = request; yield { type: "final", output: {} }; } }, checkpoints), packs: [pack] });
    const second = restarted.startConversationRun("ws", conversation.id, { message: { content: "下一步" } }); await restarted.waitForRun(second.id);
    expect(seen!.prompt.conversation).toEqual([{ role: "user", internal: "compaction", content: "verified-handoff-summary" }, { role: "user", content: "下一步" }]);
  });

  it("imports old observations once and cannot resume an imported display transcript as execution", async () => {
    const store = createMemoryAgentHostStore(); const conversation = store.createConversation({ workspaceId: "ws", timestamp: "2026-10-24T00:00:00Z" });
    const timestamp = "2026-10-24T00:00:00Z";
    const run = store.createRun({ run: { conversation_id: conversation.id, status: "failed", mutation_mode: "review", started_at: timestamp, assistant_message_id: "a" } });
    for (const message of [{ id: "u", role: "user" as const, content: "old task" }, { id: "a", role: "assistant" as const, content: "old answer", run_id: run.id }]) {
      store.appendMessage({ message: { ...message, conversation_id: conversation.id, mentions: [], created_at: timestamp } });
    }
    store.appendRunEvent({ runId: run.id, type: "tool_call_started", payload: { tool_call: { id: "old-call", name: "test.read", origin: "plugin", input: {} } }, timestamp });
    const runtime = runtimeWith({ async *stream() { yield { type: "final", output: {} }; } });
    migrateModelHistory(store, runtime);
    const imported = runtime.getCheckpoint(run.id)!;
    expect(imported.phase).toBe("history");
    expect(JSON.stringify(imported)).toContain("may have taken effect");
    store.updateMessage("a", { content: "changed UI" }); migrateModelHistory(store, runtime);
    expect(runtime.getCheckpoint(run.id)).toEqual(imported);
    const host = createAgentHost({ store, runtime, packs: [pack] });
    expect(() => host.startConversationRun("ws", conversation.id, { message: { content: "resume" }, resumeFromRunId: run.id })).toThrow("not_resumable");
  });
});
