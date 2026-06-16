import { once } from "node:events";
import { createHarnessRuntime, type HarnessModelRequest } from "@typedance/harness-core";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentHost, createAgentHostServer, type AgentHostHttpServer } from "../src";

const servers: AgentHostHttpServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("agent host", () => {
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
        loadMentionedContext: async ({ mentions }) => `Context: ${mentions.map((mention) => mention.label).join(", ")}`,
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
    expect(host.listConversations("doc_1")[0]?.title).toBe("参考岗位 JD 优化专业技能");
    const messages = host.listMessages(conversation.id);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.mentions[0]?.label).toBe("岗位 JD");
    expect(messages[1]?.content).toBe("可以优化专业技能。");
    expect(seenRequests[0]?.messages).toEqual([
      { role: "system", content: "Context: 岗位 JD" },
      { role: "user", content: "参考岗位 JD 优化专业技能" },
    ]);
    expect(host.listAgentRunEvents(run.id).map((event) => event.type)).toEqual([
      "harness_event",
      "thinking_delta",
      "assistant_delta",
      "run_completed",
    ]);
  });

  it("grounds resume conversations in the current workspace canvas before prior chat history", async () => {
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
        loadWorkspaceContext: async () => [
          "Current active resume canvas:",
          "  document_id: doc_1",
          "  title: 刚铭俊",
          "  content:",
          "    刚铭俊",
          "    前端技术负责人 / 前端架构师 / AI 应用开发",
        ].join("\n"),
        loadMentionedContext: async () => undefined,
      },
    });

    const conversation = host.createConversation("doc_1");
    host.startConversationRun("doc_1", conversation.id, {
      message: { content: "上一份是张择天的简历" },
      mutationMode: "suggest",
    });
    const run = host.startConversationRun("doc_1", conversation.id, {
      message: { content: "检查这份简历质量" },
      mutationMode: "suggest",
    });
    await host.waitForRun(run.id);

    const latestRequest = seenRequests.at(-1);
    expect(latestRequest?.messages[0]).toMatchObject({
      role: "system",
      content: expect.stringContaining("刚铭俊"),
    });
    expect(latestRequest?.messages.at(-1)).toEqual({
      role: "user",
      content: "检查这份简历质量",
    });
  });

  it("exposes workspace conversation APIs over HTTP", async () => {
    const runtime = createHarnessRuntime({
      model: {
        stream: async function* () {
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
    const server = createAgentHostServer({ host });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server.nodeServer, "listening");

    const created = await fetch(`${server.url}/workspaces/doc_1/conversations`, { method: "POST" });
    expect(created.status).toBe(201);
    const conversation = await created.json();

    const runResponse = await fetch(`${server.url}/workspaces/doc_1/conversations/${conversation.id}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: { content: "检查简历" },
        mutation_mode: "suggest",
      }),
    });
    expect(runResponse.status).toBe(201);
    const run = await runResponse.json();
    await host.waitForRun(run.id);

    const messages = await fetch(`${server.url}/conversations/${conversation.id}/messages`).then((response) => response.json());
    expect(messages[1].content).toBe("收到。");
    const events = await fetch(`${server.url}/agent-runs/${run.id}/events`).then((response) => response.json());
    expect(events.some((event: { type: string }) => event.type === "assistant_delta")).toBe(true);
  });
});
