import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHarnessRuntime } from "@typedance/harness-core";
import { createAgentHost, createAgentHostServer, type AgentHostHttpServer } from "../src";
import { approvalHost, approvalSnapshot, nextManualProposal } from "./helpers/editor-approval-host";

const token = "account-close-test-token-01234567890123456789";
const headers = { authorization: `Bearer ${token}` };
const servers: AgentHostHttpServer[] = [];
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("account service draining", () => {
  it("pauses all conversations before saving and resumes only new work after a failed save", async () => {
    let entered = 0;
    const runtime = createHarnessRuntime({ model: { async *stream(input) {
      entered++;
      yield { type: "assistant_delta", messageId: input.runId, delta: "working" };
      await new Promise<void>((resolve) => {
        if (input.signal.aborted) resolve();
        else input.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      yield { type: "final", output: {} };
    } } });
    runtime.registerPlugin({ id: "test", name: "Test", version: "1", module_format: "esm", scopes: ["test"], agents: [{ id: "test.agent", name: "Test", role: "primary" }] });
    const host = createAgentHost({ runtime, packs: [{ id: "resume", primaryAgentId: "test.agent", capabilityPolicy: { pluginIds: ["test"] } }] });
    const first = host.createConversation("workspace");
    const second = host.createConversation("workspace");
    const runs = [first, second].map((conversation) => host.startConversationRun("workspace", conversation.id, { message: { content: "test" } }));
    const server = createAgentHostServer({ authToken: token, host });
    servers.push(server); server.listen(); await once(server.nodeServer, "listening");
    await vi.waitFor(() => expect(entered).toBe(2));
    expect((await fetch(`${server.url}/account/pause`, { method: "POST" })).status).toBe(401);
    expect((await fetch(`${server.url}/account/resume`, { method: "POST" })).status).toBe(401);
    const paused = await fetch(`${server.url}/account/pause`, { method: "POST", headers });
    expect(paused.status).toBe(200);
    expect(await paused.json()).toEqual({ ok: true });
    for (const run of runs) expect(host.getAgentRun(run.id).status).toBe("cancelled");
    expect(() => host.startConversationRun("workspace", first.id, { message: { content: "must not run" } })).toThrow("account_paused");
    await expect(host.steerAgentRun(runs[0].id, { message: { content: "must not steer" } })).rejects.toThrow("account_paused");
    expect(host.listConversations("workspace")).toHaveLength(2);
    expect((await fetch(`${server.url}/account/pause`, { method: "POST", headers })).status).toBe(200);
    const resumed = await fetch(`${server.url}/account/resume`, { method: "POST", headers });
    expect(resumed.status).toBe(200);
    expect(await resumed.json()).toEqual({ ok: true });
    const next = host.startConversationRun("workspace", first.id, { message: { content: "new work" } });
    await vi.waitFor(() => expect(entered).toBe(3));
    expect(host.getAgentRun(next.id).status).toBe("running");
    await server.prepareClose();
    expect(host.getAgentRun(next.id).status).toBe("cancelled");
    expect((await fetch(`${server.url}/account/resume`, { method: "POST", headers })).status).toBe(409);
    await expect(host.resumeAccount()).rejects.toThrow("account_closing");
    expect(() => host.startConversationRun("workspace", first.id, { message: { content: "must remain closed" } })).toThrow("account_closing");
  });

  it("does not let an in-flight resume reopen admission after prepare-close", async () => {
    const runtime = createHarnessRuntime({ model: { async *stream() { yield { type: "final", output: {} }; } } });
    const host = createAgentHost({ runtime, packs: [] });
    const paused = host.pauseAccount();
    const resumed = host.resumeAccount();
    const closed = host.prepareClose();
    await expect(resumed).rejects.toThrow("account_closing");
    await Promise.all([paused, closed]);
    await expect(host.resumeAccount()).rejects.toThrow("account_closing");
  });

  it("cancels every conversation, closes its event stream and rejects new work", async () => {
    let entered = 0;
    const runtime = createHarnessRuntime({ model: { async *stream(input) {
      entered++;
      yield { type: "assistant_delta", messageId: input.runId, delta: "working" };
      await new Promise<void>((resolve) => {
        if (input.signal.aborted) resolve();
        else input.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      yield { type: "final", output: {} };
    } } });
    runtime.registerPlugin({ id: "test", name: "Test", version: "1", module_format: "esm", scopes: ["test"], agents: [{ id: "test.agent", name: "Test", role: "primary" }] });
    const host = createAgentHost({ runtime, packs: [{ id: "resume", primaryAgentId: "test.agent", capabilityPolicy: { pluginIds: ["test"] } }] });
    const first = host.createConversation("workspace");
    const second = host.createConversation("workspace");
    const runs = [first, second].map((conversation) => host.startConversationRun("workspace", conversation.id, { message: { content: "test" } }));
    const server = createAgentHostServer({ authToken: token, host });
    servers.push(server); server.listen(); await once(server.nodeServer, "listening");
    await vi.waitFor(() => expect(entered).toBe(2));
    const stream = await fetch(`${server.url}/agent-runs/${runs[0].id}/events?stream=1`, { headers });
    const closed = stream.text().then(() => true, () => true);
    const response = await fetch(`${server.url}/account/prepare-close`, { method: "POST", headers });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(await closed).toBe(true);
    for (const run of runs) expect(host.getAgentRun(run.id).status).toBe("cancelled");
    expect(() => host.startConversationRun("workspace", first.id, { message: { content: "must not run" } })).toThrow("account_closing");
    expect((await fetch(`${server.url}/workspaces/workspace/conversations`, { method: "POST", headers })).status).toBe(409);
    expect((await fetch(`${server.url}/health`, { headers })).status).toBe(200);
    expect((await fetch(`${server.url}/account/prepare-close`, { method: "POST", headers })).status).toBe(200);
  });

  it("releases pending manual editor approvals without applying the document", async () => {
    const directory = await mkdtemp(join(tmpdir(), "account-close-approval-"));
    directories.push(directory);
    const { host, store } = await approvalHost(directory, approvalSnapshot);
    try {
      const conversation = host.createConversation("doc");
      const run = host.startConversationRun("doc", conversation.id, { message: { content: "edit" }, mutationMode: "review", context: { editor_snapshot: approvalSnapshot } });
      const proposal = await nextManualProposal(host, run.id, approvalSnapshot);
      await host.prepareClose();
      expect(host.getAgentRun(run.id).status).toBe("cancelled");
      expect(() => host.beginEditorRequest(run.id, proposal.id)).toThrow();
      expect(host.listAgentRunEvents(run.id).some((event) => event.type === "editor_response" && event.payload.status === "applied")).toBe(false);
      await host.prepareClose();
    } finally { await host.prepareClose(); store.close(); }
  });
});
