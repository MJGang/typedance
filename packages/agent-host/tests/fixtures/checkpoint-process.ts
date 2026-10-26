import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { createHarnessRuntime } from "@typedance/harness-core";
import { createAgentHost, createAgentHostServer, createSqliteAgentHostStore, JsonFileHarnessCheckpointStore } from "../../src";

const directory = process.argv[2]!;
const mode = process.argv[3]!;
const runtime = createHarnessRuntime({
  checkpointStore: new JsonFileHarnessCheckpointStore(join(directory, "checkpoints")),
  model: { async *stream(request) {
    if (mode === "initial") {
      for (const id of ["completed", "uncertain"]) yield { type: "tool_call", call: { id, name: "test.work", origin: "plugin", input: { id } } };
    } else {
      const messages = request.prompt.conversation;
      if (!messages.some((message) => message.role === "tool" && message.toolCallId === "completed" && JSON.stringify(message.content).includes("saved-evidence"))) throw new Error("Lost completed tool evidence");
      if (!messages.some((message) => message.role === "tool" && message.toolCallId === "uncertain" && JSON.stringify(message.content).includes("may have taken effect"))) throw new Error("Lost interrupted tool state");
      if (!request.prompt.conversation.some((message) => message.role === "user" && message.contextSource === "harness.task" && String(message.content).includes("Verify both deliverables"))) throw new Error("Lost original objective");
      yield { type: "assistant_delta", messageId: "answer", delta: "Resumed from saved evidence" };
      yield { type: "final", output: { recovered: true } };
    }
  } },
});
runtime.registerPlugin({ id: "test", name: "Test", version: "1", module_format: "esm", scopes: ["test"],
  agents: [{ id: "test.agent", name: "Test", role: "primary", allowed_tool_names: ["test.work"] }] });
runtime.registerTool({ name: "test.work", origin: "plugin", handler: async (input) => {
  appendFileSync(join(directory, "invocations.txt"), `${input.id}\n`);
  if (input.id === "uncertain") { process.send?.({ type: "in-flight" }); return new Promise(() => {}); }
  return { evidence: "saved-evidence" };
} });
const host = createAgentHost({ runtime, store: createSqliteAgentHostStore(join(directory, "store.sqlite")),
  packs: [{ id: "test", primaryAgentId: "test.agent", capabilityPolicy: { scopeIds: ["test"] } }] });
const server = createAgentHostServer({ host, authToken: "checkpoint-integration-token-0123456789" });
server.listen(0, "127.0.0.1");
server.nodeServer.on("listening", () => { process.send?.({ type: "listening", port: Number(new URL(server.url).port) }); });
