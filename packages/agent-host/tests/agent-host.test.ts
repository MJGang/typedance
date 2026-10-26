import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHarnessRuntime, type HarnessModelRequest } from "@typedance/harness-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentHost, createAgentHostServer, createMemoryAgentHostStore, type AgentHostHttpServer } from "../src";
import { createFileModelSettings } from "../src/model-settings";

const authToken = "test-agent-host-token-01234567890123456789";
const apiFetch: typeof fetch = (input, init = {}) => fetch(input, { ...init, headers: { authorization: `Bearer ${authToken}`, ...init.headers } });

const servers: AgentHostHttpServer[] = [];
const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(tempDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("agent host", () => {
  it("allows CORS preflight for every routed HTTP method", async () => {
    const runtime = createHarnessRuntime({
      model: {
        stream: async function* () {
          yield { type: "final", output: {} };
        },
      },
    });
    const host = createAgentHost({ runtime, packs: [] });
    const server = createAgentHostServer({ authToken, host });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server.nodeServer, "listening");

    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      const response = await apiFetch(`${server.url}/settings/model`, {
        method: "OPTIONS",
        headers: {
          origin: "http://tauri.localhost",
          "access-control-request-method": method,
          "access-control-request-headers": "content-type",
        },
      });

      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe("http://tauri.localhost");
      expect(response.headers.get("access-control-allow-methods")?.split(",")).toContain(method);
      expect(response.headers.get("access-control-allow-headers")?.split(",")).toContain("content-type");
    }
  });

  it("serves health and redacted model settings", async () => {
    const runtime = createHarnessRuntime({
      model: {
        stream: async function* () {
          yield { type: "final", output: {} };
        },
      },
    });
    const host = createAgentHost({ runtime, packs: [] });
    const dataDir = await mkdtemp(join(tmpdir(), "typedance-agent-host-http-"));
    tempDirectories.push(dataDir);
    const modelSettings = createFileModelSettings(dataDir, {});
    const server = createAgentHostServer({ authToken, host, modelSettings });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server.nodeServer, "listening");

    expect(await apiFetch(`${server.url}/health`).then((response) => response.json())).toEqual({
      status: "ok",
      service: "agent-host",
    });

    const updated = await apiFetch(`${server.url}/settings/model`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        base_url: "https://api.deepseek.com",
        api_key: "sk-http-a9f2",
      }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual({
      provider: "deepseek",
      model: "deepseek-v4-flash",
      base_url: "https://api.deepseek.com",
      api_key: { configured: true, preview: "...a9f2" },
    });

    const invalid = await apiFetch(`${server.url}/settings/model`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "", base_url: "not-a-url" }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "invalid_model_settings" });

    const cleared = await apiFetch(`${server.url}/settings/model/api-key`, { method: "DELETE" });
    expect(cleared.status).toBe(200);
    expect((await cleared.json()).api_key).toEqual({ configured: false, preview: null });
    const selection = await apiFetch(`${server.url}/settings/model/selection`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "deepseek-flash", reasoning_effort: "max" }),
    });
    expect(selection.status).toBe(200);
    expect(await selection.json()).toMatchObject({ model: "deepseek-flash", reasoning_effort: "max" });
    expect(await apiFetch(`${server.url}/settings/model/selection`).then((response) => response.json())).toMatchObject({ model: "deepseek-flash", reasoning_effort: "max" });
    const invalidSelection = await apiFetch(`${server.url}/settings/model/selection`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "deepseek-flash", reasoning_effort: "ultra" }),
    });
    expect(invalidSelection.status).toBe(400);
  });
  it("persists workspace conversation messages and projected run events", async () => {
    const seenRequests: HarnessModelRequest[] = [];
    const runtime = createHarnessRuntime({
      model: {
        stream: async function* (request) {
          seenRequests.push(request);
          yield {
            type: "reasoning_summary_delta",
            summaryId: "summary_1",
            delta: "Thinking about the resume.",
          };
          yield {
            type: "assistant_delta",
            messageId: "assistant_1",
            delta: "可以优化专业技能。",
          };
          yield {
            type: "final",
            output: { ok: true },
          };
        },
      },
    });
    runtime.registerPlugin({
      id: "resume.agent",
      name: "Resume Agent",
      version: "0.1.0",
      module_format: "esm",
      scopes: ["pack:resume"],
      agents: [{ id: "resume.primary", name: "Resume Primary", role: "primary", skill_ids: [] }],
    });
    const host = createAgentHost({
      runtime,
      packs: [
        {
          id: "resume",
          capabilityPolicy: { scopeIds: ["pack:resume"] },
          primaryAgentId: "resume.primary",
        },
      ],
      contextProvider: {
        loadContext: async ({ mentions }) => [{ id: "mention.0", kind: "mention", content: `Context: ${mentions.map((mention) => mention.label).join(", ")}` }],
      },
      now: (() => {
        let tick = 0;
        return () => new Date(Date.UTC(2026, 5, 16, 0, 0, tick++));
      })(),
    });

    const conversation = host.createConversation("doc_1");
    const run = host.startConversationRun("doc_1", conversation.id, {
      message: {
        content: "参考岗位 JD 优化专业技能",
        mentions: [{
          context_source_id: "ctx_1",
          type: "webpage",
          label: "岗位 JD",
          uri: "https://example.com/jobs/frontend",
        }],
      },
      model: "gpt-5",
      mutationMode: "review",
    });
    await host.waitForRun(run.id);

    expect(host.getAgentRun(run.id).status).toBe("completed");
    expect(host.listConversations("doc_1")[0]?.preview).toBe("参考岗位 JD 优化专业技能");
    expect(host.listConversations("doc_1")[0]?.first_user_message).toBe("参考岗位 JD 优化专业技能");
    expect(host.listConversations("doc_1")[0]?.name).toBeNull();
    const messages = host.listMessages(conversation.id);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.mentions[0]?.label).toBe("岗位 JD");
    expect(messages[1]?.content).toBe("可以优化专业技能。");
    expect("messages" in (seenRequests[0] ?? {})).toBe(false);
    expect(seenRequests[0]?.prompt.conversation).toContainEqual(expect.objectContaining({
      internal: "context",
      contextSource: "mention.0",
      content: expect.stringContaining("Context:"),
    }));
    expect(seenRequests[0]?.prompt.conversation.filter((message) => message.role !== "user" || !message.internal)).toEqual([
      { role: "user", content: "参考岗位 JD 优化专业技能" },
    ]);
    expect(JSON.stringify(seenRequests[0]?.prompt)).not.toContain("workspace_id");
    expect(host.listAgentRunEvents(run.id).map((event) => event.type)).toEqual([
      "harness_event",
      "harness_event",
      "harness_event",
      "harness_event",
      "thinking_delta",
      "assistant_delta",
      "harness_event",
      "harness_event",
      "run_completed",
    ]);
  });

  it("derives the conversation preview from the first user message before the model finishes", async () => {
    let finishModel: (() => void) | undefined;
    const modelCanFinish = new Promise<void>((resolve) => {
      finishModel = resolve;
    });
    const runtime = createHarnessRuntime({
      model: {
        stream: async function* () {
          await modelCanFinish;
          yield { type: "final", output: { ok: true } };
        },
      },
    });
    runtime.registerPlugin({
      id: "resume.agent",
      name: "Resume Agent",
      version: "0.1.0",
      module_format: "esm",
      scopes: ["pack:resume"],
      agents: [{ id: "resume.primary", name: "Resume Primary", role: "primary", skill_ids: [] }],
    });
    const host = createAgentHost({
      runtime,
      packs: [
        {
          id: "resume",
          capabilityPolicy: { scopeIds: ["pack:resume"] },
          primaryAgentId: "resume.primary",
        },
      ],
      now: (() => {
        let tick = 0;
        return () => new Date(Date.UTC(2026, 5, 16, 1, 0, tick++));
      })(),
    });

    const conversation = host.createConversation("doc_1");
    expect(conversation.name).toBeNull();
    expect(conversation.preview).toBe("");

    const run = host.startConversationRun("doc_1", conversation.id, {
      message: {
        content: "检查这份简历质量，并指出最影响求职成功率的问题",
        mentions: [],
      },
      mutationMode: "review",
    });

    const updatedConversation = host.listConversations("doc_1")[0];
    expect(updatedConversation?.name).toBeNull();
    expect(updatedConversation?.preview).toBe("检查这份简历质量，并指出最影响求职成功率的问题");
    expect(updatedConversation?.first_user_message).toBe("检查这份简历质量，并指出最影响求职成功率的问题");
    expect(updatedConversation?.status).toBe("running");

    finishModel?.();
    await host.waitForRun(run.id);
  });

  it("keeps an explicit conversation name when deriving the preview", async () => {
    const runtime = createHarnessRuntime({
      model: {
        stream: async function* () {
          yield { type: "final", output: { ok: true } };
        },
      },
    });
    runtime.registerPlugin({
      id: "resume.agent",
      name: "Resume Agent",
      version: "0.1.0",
      module_format: "esm",
      scopes: ["pack:resume"],
      agents: [{ id: "resume.primary", name: "Resume Primary", role: "primary", skill_ids: [] }],
    });
    const host = createAgentHost({
      runtime,
      packs: [
        {
          id: "resume",
          capabilityPolicy: { scopeIds: ["pack:resume"] },
          primaryAgentId: "resume.primary",
        },
      ],
      now: (() => {
        let tick = 0;
        return () => new Date(Date.UTC(2026, 5, 16, 1, 30, tick++));
      })(),
    });

    const conversation = host.createConversation("doc_1", "Quality Check");
    const run = host.startConversationRun("doc_1", conversation.id, {
      message: {
        content: "Check the resume against the frontend lead role",
        mentions: [],
      },
      mutationMode: "review",
    });

    const runningConversation = host.listConversations("doc_1")[0];
    expect(runningConversation?.name).toBe("Quality Check");
    expect(runningConversation?.preview).toBe("Check the resume against the frontend lead role");

    await host.waitForRun(run.id);
    expect(host.listConversations("doc_1")[0]?.name).toBe("Quality Check");
  });

  it("grounds resume conversations in the latest workspace snapshot beside prior chat history", async () => {
    const seenRequests: HarnessModelRequest[] = [];
    const runtime = createHarnessRuntime({
      model: {
        stream: async function* (request) {
          seenRequests.push(request);
          yield { type: "assistant_delta", messageId: "assistant_1", delta: "正在检查刚铭俊的简历。" };
          yield { type: "final", output: { ok: true } };
        },
      },
    });
    runtime.registerPlugin({
      id: "resume.agent",
      name: "Resume Agent",
      version: "0.1.0",
      module_format: "esm",
      scopes: ["pack:resume"],
      agents: [{ id: "resume.primary", name: "Resume Primary", role: "primary", skill_ids: [] }],
    });
    const host = createAgentHost({
      runtime,
      packs: [
        {
          id: "resume",
          capabilityPolicy: { scopeIds: ["pack:resume"] },
          primaryAgentId: "resume.primary",
        },
      ],
      contextProvider: {
        loadContext: async () => [{ id: "workspace.current", kind: "workspace", content: [
          "Current active resume canvas:",
          "  document_id: doc_1",
          "  title: 刚铭俊",
          "  content:",
          "    刚铭俊",
          "    前端技术负责人 / 前端架构师 / AI 应用开发",
        ].join("\n") }],
      },
    });

    const conversation = host.createConversation("doc_1");
    const previousRun = host.startConversationRun("doc_1", conversation.id, {
      message: { content: "上一份是张择天的简历" },
      mutationMode: "suggest",
    });
    await host.waitForRun(previousRun.id);
    const run = host.startConversationRun("doc_1", conversation.id, {
      message: { content: "检查这份简历质量" },
      mutationMode: "suggest",
    });
    await host.waitForRun(run.id);

    const latestRequest = seenRequests.at(-1);
    expect("messages" in (latestRequest ?? {})).toBe(false);
    expect(latestRequest?.prompt.conversation).toContainEqual(expect.objectContaining({
      internal: "context",
      contextSource: "workspace.current",
      content: expect.stringContaining("刚铭俊"),
    }));
    expect(latestRequest?.prompt.conversation).toContainEqual({
      role: "user",
      content: "检查这份简历质量",
    });
  });

  it("records model stream failures without rejecting the background run task", async () => {
    const runtime = createHarnessRuntime({
      model: {
        stream: async function* () {
          throw new Error("socket closed");
        },
      },
    });
    runtime.registerPlugin({
      id: "resume.agent",
      name: "Resume Agent",
      version: "0.1.0",
      module_format: "esm",
      scopes: ["pack:resume"],
      agents: [{ id: "resume.primary", name: "Resume Primary", role: "primary", skill_ids: [] }],
    });
    const host = createAgentHost({
      runtime,
      packs: [
        {
          id: "resume",
          capabilityPolicy: { scopeIds: ["pack:resume"] },
          primaryAgentId: "resume.primary",
        },
      ],
    });
    const conversation = host.createConversation("doc_1");

    const run = host.startConversationRun("doc_1", conversation.id, {
      message: { content: "Check this resume" },
    });

    await expect(host.waitForRun(run.id)).resolves.toBeUndefined();
    expect(host.getAgentRun(run.id).status).toBe("failed");
    expect(host.listAgentRunEvents(run.id).some((event) => event.type === "run_failed")).toBe(true);
  });

  it("keeps a permission request active and projects cancellation once", async () => {
    const runtime = createHarnessRuntime({
      model: {
        stream: async function* () {
          yield {
            type: "tool_call",
            call: {
              id: "tool_call_permission",
              name: "resume.readProtectedContext",
              origin: "resource",
              input: { uri: "file:///protected.txt" },
            },
          };
          yield { type: "final", output: { ok: false } };
        },
      },
    });
    runtime.registerPlugin({
      id: "resume.agent",
      name: "Resume Agent",
      version: "0.1.0",
      module_format: "esm",
      scopes: ["pack:resume"],
      skills: [
        {
          id: "resume.context",
          name: "Resume Context",
          description: "Read resume context.",
          instruction_files: [],
          tool_names: ["resume.readProtectedContext"],
        },
      ],
      agents: [{
        id: "resume.primary",
        name: "Resume Primary",
        role: "primary",
        skill_ids: ["resume.context"],
      }],
    });
    runtime.registerTool({
      name: "resume.readProtectedContext",
      origin: "resource",
      requiresPermission: (input) => ({
        kind: "filesystem.read",
        reason: "Read protected context.",
        scope: {
          uri: String(input.uri),
          access: "read",
        },
      }),
      handler: async () => ({ ok: true }),
    });
    const host = createAgentHost({
      runtime,
      packs: [
        {
          id: "resume",
          capabilityPolicy: { scopeIds: ["pack:resume"] },
          primaryAgentId: "resume.primary",
        },
      ],
    });
    const conversation = host.createConversation("doc_1");

    const run = host.startConversationRun("doc_1", conversation.id, {
      message: { content: "读取受保护上下文" },
    });

    await vi.waitFor(() => expect(runtime.getRun(run.id).status).toBe("awaiting_permission"));
    expect(host.getAgentRun(run.id).status).toBe("running");
    host.cancelAgentRun(run.id);
    await expect(host.waitForRun(run.id)).resolves.toBeUndefined();
    expect(host.listAgentRunEvents(run.id).filter((event) => event.type === "run_failed")).toHaveLength(0);
    expect(host.listAgentRunEvents(run.id).filter((event) => event.type === "run_cancelled")).toHaveLength(1);
  });

  it("recovers persisted running runs as failed after the host restarts", () => {
    const runtime = createHarnessRuntime({
      model: {
        stream: async function* () {
          yield { type: "final", output: { ok: true } };
        },
      },
    });
    runtime.registerPlugin({
      id: "resume.agent",
      name: "Resume Agent",
      version: "0.1.0",
      module_format: "esm",
      scopes: ["pack:resume"],
      agents: [{ id: "resume.primary", name: "Resume Primary", role: "primary", skill_ids: [] }],
    });
    const store = createMemoryAgentHostStore({
      conversations: [{
        id: "conv_1",
        workspace_id: "doc_1",
        name: "Stale run",
        preview: "",
        pinned: false,
        status: "running",
        created_at: "2026-06-16T08:00:00.000Z",
        updated_at: "2026-06-16T08:00:00.000Z",
        last_message_at: "2026-06-16T08:00:00.000Z",
      }],
      messages: [{
        id: "msg_1",
        conversation_id: "conv_1",
        role: "assistant",
        content: "",
        mentions: [],
        created_at: "2026-06-16T08:00:00.000Z",
        run_id: "run_1",
      }],
      runs: [{
        id: "run_1",
        conversation_id: "conv_1",
        assistant_message_id: "msg_1",
        status: "running",
        model: "deepseek-v4-flash",
        mutation_mode: "review",
        started_at: "2026-06-16T08:00:00.000Z",
      }],
      events: [],
    });

    const host = createAgentHost({
      runtime,
      store,
      packs: [
        {
          id: "resume",
          capabilityPolicy: { scopeIds: ["pack:resume"] },
          primaryAgentId: "resume.primary",
        },
      ],
      now: () => new Date("2026-06-16T08:30:00.000Z"),
    });

    expect(host.getAgentRun("run_1").status).toBe("failed");
    expect(host.listConversations("doc_1")[0]?.status).toBe("failed");
    expect(host.listAgentRunEvents("run_1").map((event) => event.type)).toEqual(["run_failed"]);
  });

  it("does not reuse persisted run events when the harness run id resets after restart", async () => {
    const runtime = createHarnessRuntime({
      model: {
        stream: async function* () {
          yield { type: "assistant_delta", messageId: "assistant_1", delta: "new answer" };
          yield { type: "final", output: { ok: true } };
        },
      },
    });
    runtime.registerPlugin({
      id: "resume.agent",
      name: "Resume Agent",
      version: "0.1.0",
      module_format: "esm",
      scopes: ["pack:resume"],
      agents: [{ id: "resume.primary", name: "Resume Primary", role: "primary", skill_ids: [] }],
    });
    const store = createMemoryAgentHostStore({
      conversations: [{
        id: "conv_1",
        workspace_id: "doc_1",
        name: "Old conversation",
        preview: "",
        pinned: false,
        status: "idle",
        created_at: "2026-06-16T08:00:00.000Z",
        updated_at: "2026-06-16T08:00:51.000Z",
        last_message_at: "2026-06-16T08:00:51.000Z",
      }],
      messages: [{
        id: "msg_old_assistant",
        conversation_id: "conv_1",
        role: "assistant",
        content: "",
        mentions: [],
        created_at: "2026-06-16T08:00:00.000Z",
        run_id: "run_1",
      }],
      runs: [{
        id: "run_1",
        conversation_id: "conv_1",
        assistant_message_id: "msg_old_assistant",
        status: "completed",
        model: "deepseek-v4-flash",
        mutation_mode: "review",
        started_at: "2026-06-16T08:00:00.000Z",
        completed_at: "2026-06-16T08:00:51.000Z",
        duration_ms: 51000,
      }],
      events: [
        {
          id: "aevt_1",
          run_id: "run_1",
          sequence: 0,
          type: "thinking_delta",
          payload: { delta: "old thinking about 这个简历怎么样" },
          created_at: "2026-06-16T08:00:00.000Z",
        },
        {
          id: "aevt_2",
          run_id: "run_1",
          sequence: 1,
          type: "run_completed",
          payload: { output: { ok: true } },
          created_at: "2026-06-16T08:00:51.000Z",
        },
      ],
    });
    const host = createAgentHost({
      runtime,
      store,
      packs: [
        {
          id: "resume",
          capabilityPolicy: { scopeIds: ["pack:resume"] },
          primaryAgentId: "resume.primary",
        },
      ],
    });
    const conversation = host.createConversation("doc_1");

    const run = host.startConversationRun("doc_1", conversation.id, {
      message: { content: "检查这份简历质量" },
    });
    await host.waitForRun(run.id);

    expect(run.id).not.toBe("run_1");
    const events = host.listAgentRunEvents(run.id);
    expect(events.map((event) => event.type)).toEqual(["harness_event", "harness_event", "harness_event", "harness_event", "assistant_delta", "harness_event", "run_completed"]);
    expect(JSON.stringify(events)).not.toContain("这个简历怎么样");
    expect(host.listMessages(conversation.id)[1]?.content).toBe("new answer");
  });

  it("exposes workspace conversation APIs over HTTP", async () => {
    const requests: HarnessModelRequest[] = [];
    const runtime = createHarnessRuntime({
      model: {
        stream: async function* (request) {
          requests.push(request);
          yield { type: "assistant_delta", messageId: "assistant_1", delta: "收到。" };
          yield { type: "final", output: { ok: true } };
        },
      },
    });
    runtime.registerPlugin({
      id: "resume.agent",
      name: "Resume Agent",
      version: "0.1.0",
      module_format: "esm",
      scopes: ["pack:resume"],
      agents: [{ id: "resume.primary", name: "Resume Primary", role: "primary", skill_ids: [] }],
    });
    const host = createAgentHost({
      runtime,
      packs: [
        {
          id: "resume",
          capabilityPolicy: { scopeIds: ["pack:resume"] },
          primaryAgentId: "resume.primary",
        },
      ],
    });
    const dataDir = await mkdtemp(join(tmpdir(), "typedance-current-selection-"));
    tempDirectories.push(dataDir);
    const modelSettings = createFileModelSettings(dataDir, { DEEPSEEK_REASONING_EFFORT: "low" });
    await modelSettings.update({ model: "deepseek-flash", base_url: "https://api.deepseek.com" });
    const server = createAgentHostServer({ authToken, host, modelSettings });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server.nodeServer, "listening");

    const created = await apiFetch(`${server.url}/workspaces/doc_1/conversations`, { method: "POST" });
    expect(created.status).toBe(201);
    const conversation = await created.json();

    const saved = await apiFetch(`${server.url}/settings/model`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "deepseek-v4-pro", base_url: "https://api.deepseek.com" }),
    });
    expect(saved.status).toBe(200);

    const runResponse = await apiFetch(`${server.url}/workspaces/doc_1/conversations/${conversation.id}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: { content: "检查简历" },
        model: "deepseek-flash",
        mutation_mode: "suggest",
      }),
    });
    expect(runResponse.status).toBe(201);
    const run = await runResponse.json();
    await host.waitForRun(run.id);
    expect(run.model).toBe("deepseek-v4-pro");
    expect(requests[0]).toMatchObject({ model: "deepseek-v4-pro" });
    // The provider resolves the latest reasoning setting for each model call.
    expect(requests[0].modelOptions ?? {}).not.toHaveProperty("reasoningEffort");

    const messages = await apiFetch(`${server.url}/conversations/${conversation.id}/messages`).then((response) => response.json());
    expect(messages[1].content).toBe("收到。");
    const events = await apiFetch(`${server.url}/agent-runs/${run.id}/events`).then((response) => response.json());
    expect(events.some((event: { type: string }) => event.type === "assistant_delta")).toBe(true);
  });
});
