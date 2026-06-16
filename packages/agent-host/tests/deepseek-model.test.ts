import { describe, expect, it, vi } from "vitest";
import {
  assertFlashModel,
  createDeepSeekModelAdapter,
  DEFAULT_DEEPSEEK_FLASH_MODEL,
} from "../src/model/deepseek";

describe("DeepSeek model adapter", () => {
  it("streams reasoning and assistant deltas from DeepSeek SSE chunks", async () => {
    const fetchMock = vi.fn(async () => new Response(
      new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode([
            'data: {"choices":[{"delta":{"reasoning_content":"think"}}]}',
            "",
            'data: {"choices":[{"delta":{"content":"answer"}}]}',
            "",
            "data: [DONE]",
            "",
          ].join("\n")));
          controller.close();
        },
      }),
      { status: 200 },
    ));
    const adapter = createDeepSeekModelAdapter({
      apiKey: "test-key",
      fetch: fetchMock as unknown as typeof fetch,
    });

    const events = [];
    for await (const event of adapter.stream({
      runId: "run_1",
      agentId: "agent_1",
      capabilityPolicy: { scopeIds: [], pluginIds: [] },
      messages: [{ role: "user", content: "hello" }],
      skillContext: {
        policy: { scopeIds: [], pluginIds: [] },
        agent: {
          id: "agent_1",
          name: "Agent",
          role: "primary",
          skill_ids: [],
          allowed_tool_names: [],
          pluginId: "plugin_1",
        },
        pluginIds: [],
        pluginInstructions: [],
        skills: [],
        toolNames: [],
        instructionsText: "",
      },
      availableToolNames: [],
      context: {},
    })) {
      events.push(event);
    }

    expect(fetchMock).toHaveBeenCalledWith("https://api.deepseek.com/chat/completions", expect.objectContaining({
      method: "POST",
    }));
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).model).toBe(DEFAULT_DEEPSEEK_FLASH_MODEL);
    expect(events).toEqual([
      { type: "reasoning_summary_delta", summaryId: "run_1:reasoning", delta: "think" },
      { type: "assistant_delta", messageId: "run_1:assistant", delta: "answer" },
      { type: "final", output: { model: DEFAULT_DEEPSEEK_FLASH_MODEL, empty: false } },
    ]);
  });

  it("merges supplied workspace evidence into the first system message without advertising unavailable tools", async () => {
    const fetchMock = vi.fn(async () => new Response(
      new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode([
            'data: {"choices":[{"delta":{"content":"已基于当前画布检查。"}}]}',
            "",
            "data: [DONE]",
            "",
          ].join("\n")));
          controller.close();
        },
      }),
      { status: 200 },
    ));
    const adapter = createDeepSeekModelAdapter({
      apiKey: "test-key",
      fetch: fetchMock as unknown as typeof fetch,
    });

    for await (const _event of adapter.stream({
      runId: "run_1",
      agentId: "agent_1",
      capabilityPolicy: { scopeIds: [], pluginIds: [] },
      messages: [
        {
          role: "system",
          content: [
            "Current active resume canvas:",
            "  document_id: doc_1",
            "  title: 刚铭俊",
            "  content:",
            "    刚铭俊",
            "    前端技术负责人 / 前端架构师 / AI 应用开发",
          ].join("\n"),
        },
        { role: "user", content: "检查这份简历质量" },
      ],
      skillContext: {
        policy: { scopeIds: [], pluginIds: [] },
        agent: {
          id: "agent_1",
          name: "Agent",
          role: "primary",
          skill_ids: [],
          allowed_tool_names: ["typedance.context.read"],
          pluginId: "plugin_1",
        },
        pluginIds: [],
        pluginInstructions: [],
        skills: [],
        toolNames: ["typedance.context.read"],
        instructionsText: "",
      },
      availableToolNames: ["typedance.context.read"],
      context: { document_id: "doc_1" },
    })) {
      // Drain the stream so the request is sent.
    }

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const systemMessages = body.messages.filter((message: { role: string }) => message.role === "system");

    expect(systemMessages).toHaveLength(1);
    expect(systemMessages[0].content).toContain("Current active resume canvas");
    expect(systemMessages[0].content).toContain("刚铭俊");
    expect(systemMessages[0].content).toContain("前端技术负责人 / 前端架构师 / AI 应用开发");
    expect(systemMessages[0].content).not.toContain("Available harness tools: typedance.context.read");
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "检查这份简历质量" });
  });

  it("refuses pro models", () => {
    expect(() => assertFlashModel("deepseek-v4-pro")).toThrow("Refusing to use non-flash");
  });
});
