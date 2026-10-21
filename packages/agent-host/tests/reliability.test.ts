import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { createHarnessRuntime, type HarnessModelAdapter, type HarnessModelRequest } from "@typedance/harness-core";
import { createAgentHost, createAgentHostServer, type AgentHostContextProvider, type AgentHostHttpServer } from "../src";

const token = "test-reliability-token-01234567890123456789";
const servers: AgentHostHttpServer[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => server.close())); });
function deferred() { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r; }); return { promise, resolve }; }
function setup(model: HarnessModelAdapter, contextProvider?: AgentHostContextProvider) {
  const runtime = createHarnessRuntime({ model });
  runtime.registerPlugin({ id: "test", name: "Test", version: "1", module_format: "esm", scopes: ["test"], agents: [{ id: "test.agent", name: "Test", role: "primary" }] });
  const host = createAgentHost({ runtime, contextProvider, packs: [{ id: "resume", primaryAgentId: "test.agent", capabilityPolicy: { pluginIds: ["test"] } }] });
  const conversation = host.createConversation("ws");
  const start = () => host.startConversationRun("ws", conversation.id, { message: { content: "test" } });
  return { host, conversation, start };
}

describe("host execution reliability", () => {
  it("rejects concurrent sends and deletion without appending messages, then releases the lock", async () => {
    const release = deferred();
    const { host, conversation, start } = setup({ async *stream() { await release.promise; yield { type: "final", output: {} }; } });
    const first = start();
    expect(() => start()).toThrow("conversation_run_active");
    expect(() => host.deleteConversation(conversation.id)).toThrow("conversation_run_active");
    expect(host.listMessages(conversation.id)).toHaveLength(2);
    expect(host.getConversationActiveRun(conversation.id)?.id).toBe(first.id);
    release.resolve(); await host.waitForRun(first.id);
    const second = start(); await host.waitForRun(second.id);
    expect(host.getConversationActiveRun(conversation.id)).toBeNull();
  });

  it("keeps a separate budget and provenance for each explicit source beside a long canvas", async () => {
    let request: HarnessModelRequest | undefined;
    const { host, start } = setup({ async *stream(input) { request = input; yield { type: "final", output: {} }; } }, {
      loadContext: async () => [
        { id: "workspace.current", kind: "workspace", content: "W".repeat(16000) },
        ...Array.from({ length: 6 }, (_, index) => ({ id: `mention.${index}`, kind: "mention" as const, sourceId: `source-${index}`, content: `explicit-${index}:` + "R".repeat(16000) })),
      ],
    });
    const run = start(); await host.waitForRun(run.id);
    const sections = request!.prompt.contextual;
    expect(sections).toHaveLength(7);
    expect(sections.reduce((sum, section) => sum + section.content.length, 0)).toBeLessThanOrEqual(24000);
    for (let index = 0; index < 6; index++) {
      expect(sections[index + 1].content).toContain(`explicit-${index}`);
      expect(sections[index + 1].provenance?.sourceId).toBe(`source-${index}`);
      expect(sections[index + 1].budget?.truncated).toBe(true);
    }
  });

  it("cancels context preparation promptly and allows a new turn", async () => {
    const blocked = deferred(); let reads = 0;
    const { host, start } = setup({ async *stream() { yield { type: "final", output: {} }; } }, {
      loadContext: async () => { if (++reads === 1) await blocked.promise; return []; },
    });
    const run = start(); host.cancelAgentRun(run.id); await host.waitForRun(run.id);
    expect(host.getAgentRun(run.id).status).toBe("cancelled");
    const next = start(); await host.waitForRun(next.id);
    expect(host.getAgentRun(next.id).status).toBe("completed"); blocked.resolve();
  });

  it("returns 409 for a second HTTP send and ends a terminal stream after its cursor", async () => {
    const release = deferred();
    const { host, conversation, start } = setup({ async *stream() { await release.promise; yield { type: "final", output: {} }; } });
    const server = createAgentHostServer({ host, authToken: token }); servers.push(server); server.listen(); await once(server.nodeServer, "listening");
    const run = start();
    const response = await fetch(`${server.url}/workspaces/ws/conversations/${conversation.id}/runs`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ message: { content: "second" } }),
    });
    expect(response.status).toBe(409); release.resolve(); await host.waitForRun(run.id);
    const events = host.listAgentRunEvents(run.id);
    const stream = await fetch(`${server.url}/agent-runs/${run.id}/events?stream=1&after=${events.at(-1)!.sequence}`, { headers: { authorization: `Bearer ${token}` } });
    expect(await stream.text()).toBe("");
    const canceledAgain = await fetch(`${server.url}/agent-runs/${run.id}/cancel`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
    expect(canceledAgain.status).toBe(204);
    expect(host.listAgentRunEvents(run.id)).toHaveLength(events.length);
  });
});
