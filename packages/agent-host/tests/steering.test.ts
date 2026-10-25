import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { createHarnessRuntime, type HarnessModelAdapter, type HarnessModelRequest } from "@typedance/harness-core";
import { createAgentHost, createAgentHostServer, createSidecarContextProvider, type AgentHostContextProvider, type AgentHostHttpServer } from "../src";
import type { ContextMention, HarnessAttachment } from "@typedance/contracts";

function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
const servers: AgentHostHttpServer[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => server.close())); });
const token = "test-steering-token-01234567890123456789";
function setup(model: HarnessModelAdapter, contextProvider?: AgentHostContextProvider) {
  const runtime = createHarnessRuntime({ model });
  runtime.registerPlugin({ id: "test", name: "Test", version: "1", module_format: "esm", scopes: ["test"],
    agents: [{ id: "test.agent", name: "Test", role: "primary" }] });
  const host = createAgentHost({ runtime, contextProvider, packs: [{ id: "resume", primaryAgentId: "test.agent", capabilityPolicy: { pluginIds: ["test"] } }] });
  const conversation = host.createConversation("ws");
  const start = (content = "start", attachments?: HarnessAttachment[]) => host.startConversationRun("ws", conversation.id, { message: { content, attachments } });
  return { host, conversation, start };
}

function contextFixture() {
  const reads = new Map<string, number>();
  const provider = createSidecarContextProvider({ fetch: async (input) => {
    const url = new URL(String(input));
    if (!url.pathname.startsWith("/context-sources/")) return new Response("{}", { status: 404 });
    const id = decodeURIComponent(url.pathname.split("/")[2]);
    const path = url.searchParams.get("path") ?? "root";
    const key = `${id}:${path}`;
    const count = (reads.get(key) ?? 0) + 1; reads.set(key, count);
    return new Response(JSON.stringify({ source_id: id, type: "file", title: id, uri: `file:///${id}`, text: `${key}:version-${count}`, truncated: false }));
  } });
  return { provider, reads };
}

describe("Host active run input", () => {
  it("accepts follow-up input from the remounted editor of the same document without restarting the run", async () => {
    const entered = deferred(); const release = deferred();
    const { host, conversation } = setup({ async *stream() { entered.resolve(); await release.promise; yield { type: "assistant_delta", messageId: "answer", delta: "done" }; } });
    const snapshot = { document_id: "ws", editor_session_id: "old", content_revision: 5, canvas_version: 1, doc_json: { type: "doc", content: [] }, plain_text: "" };
    const run = host.startConversationRun("ws", conversation.id, { message: { content: "start" }, context: { editor_snapshot: snapshot } });
    await entered.promise;
    const followup = await host.steerAgentRun(run.id, { message: { content: "keep the date on the same line" },
      context: { editor_snapshot: { ...snapshot, editor_session_id: "remounted", content_revision: 0 } } });
    expect(followup.run_id).toBe(run.id);
    expect(host.getConversationActiveRun(conversation.id)?.id).toBe(run.id);
    await expect(host.steerAgentRun(run.id, { message: { content: "wrong document" }, context: { editor_snapshot: { ...snapshot, document_id: "other" } } })).rejects.toThrow();
    release.resolve(); await host.waitForRun(run.id);
    expect(host.listMessages(conversation.id).filter((message) => message.id === followup.id)).toHaveLength(1);
  });
  it("accepts authenticated HTTP steering in the same run and reconstructs subsequent prompt history in processing order", async () => {
    const entered = deferred(); const release = deferred(); const requests: HarnessModelRequest[] = [];
    const { host, conversation, start } = setup({ async *stream(request) {
      requests.push(request);
      yield { type: "assistant_delta", messageId: "provider-id", delta: requests.length === 1 ? "original response" : "updated response" };
      if (requests.length === 1) { entered.resolve(); await release.promise; }
      yield { type: "final", output: {} };
    } });
    const server = createAgentHostServer({ host, authToken: token }); servers.push(server); server.listen(); await once(server.nodeServer, "listening");
    const run = start(); await entered.promise;
    const response = await fetch(`${server.url}/agent-runs/${run.id}/input`, { method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ message: { content: "make it shorter" } }),
    });
    expect(response.status).toBe(201);
    const message = await response.json() as { id: string; run_id: string };
    expect(message.run_id).toBe(run.id);
    expect(host.getConversationActiveRun(conversation.id)?.id).toBe(run.id);
    expect(host.listAgentRunEvents(run.id).some((event) => event.type === "user_input_received" && event.payload.message_id === message.id)).toBe(true);
    release.resolve(); await host.waitForRun(run.id);
    expect(host.listAgentRunEvents(run.id).some((event) => event.type === "user_input_applied" && event.payload.message_id === message.id)).toBe(true);
    expect(host.listMessages(conversation.id).filter((item) => item.content === "make it shorter")).toHaveLength(1);
    const next = start("next task"); await host.waitForRun(next.id);
    expect(requests[2].prompt.conversation.filter((message) => message.role !== "user" || !message.internal)).toEqual([
      { role: "user", content: "start" }, { role: "assistant", content: "original response" },
      { role: "user", content: "make it shorter" }, { role: "assistant", content: "updated response" },
      { role: "user", content: "next task" },
    ]);
  });

  it("rejects invalid references and ended-run input without appending orphan messages", async () => {
    const entered = deferred(); const release = deferred();
    const { host, conversation, start } = setup({ async *stream() { entered.resolve(); await release.promise; yield { type: "final", output: {} }; } });
    const run = start(); await entered.promise;
    await expect(host.steerAgentRun(run.id, { message: { content: "bad", references: [{} as never] } })).rejects.toThrow();
    expect(host.listMessages(conversation.id)).toHaveLength(2);
    release.resolve(); await host.waitForRun(run.id);
    await expect(host.steerAgentRun(run.id, { message: { content: "too late" } })).rejects.toThrow("agent_run_not_active");
    expect(host.listMessages(conversation.id)).toHaveLength(2);
  });

  it("retains accepted but unconsumed input after cancellation for the next prompt", async () => {
    const entered = deferred(); const release = deferred(); let calls = 0; let nextRequest: HarnessModelRequest | undefined;
    const { host, start } = setup({ async *stream(request) {
      if (++calls === 1) { entered.resolve(); await release.promise; }
      else nextRequest = request;
      yield { type: "final", output: {} };
    } });
    const run = start(); await entered.promise;
    const steering = await host.steerAgentRun(run.id, { message: { content: "keep this follow-up", attachments: [
      { id: "unread", name: "unread.txt", mime_type: "text/plain", size: 4, content: { type: "text", text: "keep" } },
    ] } });
    host.cancelAgentRun(run.id); await host.waitForRun(run.id); release.resolve();
    const next = start("continue"); await host.waitForRun(next.id);
    expect(JSON.stringify(nextRequest!.prompt.conversation)).toContain("keep this follow-up");
    expect(host.listAgentRunEvents(run.id).some((event) => event.type === "user_input_applied")).toBe(false);
    expect(host.listAgentRunEvents(next.id)).toContainEqual(expect.objectContaining({ type: "attachments_read", payload: expect.objectContaining({ message_id: steering.id }) }));
  });

  it("acknowledges initial files and steered images only after their own model request responds, once per input", async () => {
    const entered = deferred(); const release = deferred(); const requests: HarnessModelRequest[] = [];
    const { host, start } = setup({ async *stream(request) {
      requests.push(request);
      if (requests.length === 1) { entered.resolve(); await release.promise; }
      yield { type: "assistant_delta", messageId: "answer", delta: "read" };
    } });
    const file: HarnessAttachment = { id: "file", name: "notes.md", mime_type: "text/markdown", size: 4, content: { type: "text", text: "test" } };
    const imageData = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGQ0AAAAASUVORK5CYII=";
    const image: HarnessAttachment = { id: "image", name: "sample.png", mime_type: "image/png", size: Buffer.from(imageData.split(",")[1], "base64").length,
      content: { type: "image", image_url: imageData } };
    const run = start("read files", [file]); await entered.promise;
    expect(host.listAgentRunEvents(run.id).some((event) => event.type === "attachments_read")).toBe(false);
    const steering = await host.steerAgentRun(run.id, { message: { content: "also look at this image", attachments: [image] } });
    expect(host.listAgentRunEvents(run.id).some((event) => event.type === "attachments_read")).toBe(false);
    release.resolve(); await host.waitForRun(run.id);
    const receipts = host.listAgentRunEvents(run.id).filter((event) => event.type === "attachments_read");
    expect(receipts).toHaveLength(2);
    expect(receipts[0].payload).toMatchObject({ image_count: 0, file_count: 1, attachment_ids: ["file"] });
    expect(receipts[1].payload).toMatchObject({ image_count: 1, file_count: 0, message_id: steering.id, attachment_ids: ["image"] });
    expect(JSON.stringify(requests[1].prompt.conversation)).toContain(image.content.type === "image" && image.content.image_url);
  });

  it("never reports attachments as read when the model fails before producing a response", async () => {
    const { host, start } = setup({ async *stream() { throw new Error("model unavailable"); } });
    const run = start("read", [{ id: "file", name: "notes.md", mime_type: "text/markdown", size: 4, content: { type: "text", text: "test" } }]);
    await host.waitForRun(run.id);
    expect(host.getAgentRun(run.id).status).toBe("failed");
    expect(host.listAgentRunEvents(run.id).some((event) => event.type === "attachments_read")).toBe(false);
  });

  it.each([
    [{ context_source_id: "A", type: "file", label: "A" }, { context_source_id: "B", type: "file", label: "B" }],
    [{ context_source_id: "folder", type: "directory", label: "A", target_path: "a.md" }, { context_source_id: "folder", type: "directory", label: "B", target_path: "b.md" }],
  ] as ContextMention[][])("retains distinct steered sources and paths while refreshing only the same source", async (first, second) => {
    const entered = deferred(); const release = deferred(); const requests: HarnessModelRequest[] = [];
    const { provider } = contextFixture();
    const { host, start } = setup({ async *stream(request) {
      requests.push(request);
      if (requests.length === 1) { entered.resolve(); await release.promise; }
      yield { type: "assistant_delta", messageId: "answer", delta: "done" };
    } }, provider);
    const run = start(); await entered.promise;
    await host.steerAgentRun(run.id, { message: { content: "use A", mentions: [first] } });
    await host.steerAgentRun(run.id, { message: { content: "combine B", mentions: [second] } });
    await host.steerAgentRun(run.id, { message: { content: "refresh A", mentions: [first] } });
    release.resolve(); await host.waitForRun(run.id);
    const sources = requests[1].prompt.conversation.filter((message) => message.role === "user" && message.internal === "context" && message.contextSource?.startsWith("mention."));
    expect(sources).toHaveLength(2);
    expect(new Set(sources.map((message) => message.role === "user" && message.contextSource)).size).toBe(2);
    expect(sources[0].content).toContain(`${first.context_source_id}:${first.target_path ?? "root"}:version-2`);
    expect(sources[1].content).toContain(`${second.context_source_id}:${second.target_path ?? "root"}:version-1`);
  });

  it("reloads unconsumed mentioned sources after cancellation and marks their later consumption durably", async () => {
    const entered = deferred(); const release = deferred(); const requests: HarnessModelRequest[] = [];
    const { provider, reads } = contextFixture();
    const { host, start } = setup({ async *stream(request) {
      requests.push(request);
      if (requests.length === 1) { entered.resolve(); await release.promise; }
      yield { type: "assistant_delta", messageId: "answer", delta: "done" };
    } }, provider);
    const run = start(); await entered.promise;
    const steering = await host.steerAgentRun(run.id, { message: { content: "use this source", mentions: [
      { context_source_id: "folder", type: "directory", label: "source", target_path: "guide.md" },
    ] } });
    host.cancelAgentRun(run.id); await host.waitForRun(run.id); release.resolve();
    const next = start("continue"); await host.waitForRun(next.id);
    expect(JSON.stringify(requests[1].prompt.conversation)).toContain("folder:guide.md:version-2");
    expect(JSON.stringify(requests[1].prompt.conversation)).toContain("use this source");
    expect(host.listAgentRunEvents(next.id)).toContainEqual(expect.objectContaining({ type: "harness_event", payload: expect.objectContaining({ event: expect.objectContaining({ type: "model.input.consumed", input_ids: expect.arrayContaining([steering.id]) }) }) }));
    const third = start("next task"); await host.waitForRun(third.id);
    expect(reads.get("folder:guide.md")).toBe(2);
    expect(requests[2].prompt.conversation).toContainEqual(expect.objectContaining({ internal: "context", content: expect.stringContaining("has been removed") }));
  });
});
