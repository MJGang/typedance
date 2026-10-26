import type {
  HarnessAgentSkillContext,
  HarnessModelMessage,
  HarnessModelRequest,
} from "@typedance/harness-core";
import { describe, expect, it, vi } from "vitest";
import {
  createDeepSeekModelAdapter,
} from "../src/model/deepseek";
import { buildAgentHostPromptBundle } from "../src/prompt";

describe("DeepSeek model adapter", () => {
  it("keeps tool schemas, choices and collision mappings stable for compaction and registration order", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response(sse("data: [DONE]\n\n")));
    const adapter = createDeepSeekModelAdapter({ resolveSettings: () => ({ apiKey: "test", baseUrl: undefined, defaultModel: "deepseek-flash" }), fetch: fetchMock });
    const tools = ["a.b", "a_b", "z"].map((name) => ({ name, origin: "plugin" as const, description: name, inputSchema: { type: "object", properties: {} } }));
    const request = makeRequest({ runId: "cache", agentId: "a", messages: [
      { role: "assistant", content: "", reasoningContent: "preserve exactly", toolCalls: [{ id: "c", name: "a_b", origin: "plugin", input: {} }] },
      { role: "tool", toolCallId: "c", toolName: "a_b", content: "ok" },
    ], availableTools: tools });
    await drain(adapter.stream(request));
    await drain(adapter.stream({ ...request, availableTools: [...tools].reverse(), purpose: "compaction" }));
    const [first, compact] = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
    expect(compact.messages).toEqual(first.messages);
    expect(compact.tools).toEqual(first.tools);
    expect(first.messages.find((message: { role: string }) => message.role === "assistant")).toMatchObject({ reasoning_content: "preserve exactly", tool_calls: [expect.objectContaining({ function: { name: "a_b_2", arguments: "{}" } })] });
    expect(first.tool_choice).toBe("auto");
    expect(compact.tool_choice).toBe(first.tool_choice);
    await drain(adapter.stream({ ...request, availableTools: [] }));
    const withoutTools = JSON.parse(String(fetchMock.mock.calls[2][1]?.body));
    expect(withoutTools.messages.find((message: { role: string }) => message.role === "assistant")).not.toHaveProperty("reasoning_content");
  });

  it.each([401, 402, 429, 500, 503])("classifies HTTP %i without exposing the credential", async (status) => {
    const adapter = createDeepSeekModelAdapter({ resolveSettings: () => ({ apiKey: "test-secret-key", baseUrl: "https://api.deepseek.com", defaultModel: "deepseek-v4-flash" }),
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response("test-secret-key upstream error", { status, headers: { "retry-after": "2" } })) });
    await expect(drain(adapter.stream(makeRequest({ runId: "error", agentId: "a", messages: [] })))).rejects.toMatchObject({
      retryable: [429, 500, 503].includes(status), retryAfterMs: 2000, message: `DeepSeek chat completion failed: ${status} [redacted] upstream error`,
    });
  });
  it("preserves user image parts and document text in provider requests", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(sse("data: [DONE]\n\n")));
    const adapter = createDeepSeekModelAdapter({ resolveSettings: () => ({ apiKey: "test", baseUrl: "https://api.deepseek.com", defaultModel: "deepseek-flash" }), fetch: fetchMock });
    await drain(adapter.stream(makeRequest({ runId: "user-images", agentId: "agent", messages: [{ role: "user", content: [
      { type: "text", text: "请阅读图片和文档" }, { type: "image", image_url: "data:image/png;base64,aGVsbG8=" }, { type: "text", text: "附件：项目说明.md\nPostgreSQL" },
    ] }] })));
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.messages.at(-1)).toEqual({ role: "user", content: [
      { type: "text", text: "请阅读图片和文档" }, { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } }, { type: "text", text: "附件：项目说明.md\nPostgreSQL" },
    ] });
  });
  it("sends tool images as real provider image parts with their call ID", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(sse("data: [DONE]\n\n")));
    const adapter = createDeepSeekModelAdapter({ resolveSettings: () => ({ apiKey: "test", baseUrl: "https://api.deepseek.com", defaultModel: "deepseek-flash" }), fetch: fetchMock });
    await drain(adapter.stream(makeRequest({ runId: "images", agentId: "agent", messages: [
      { role: "assistant", content: "", toolCalls: [{ id: "call", name: "view", origin: "plugin", input: {} }] },
      { role: "tool", toolCallId: "call", toolName: "view", content: [{ type: "text", text: "page 2" }, { type: "image", image_url: "data:image/png;base64,aGVsbG8=", detail: "high" }] },
    ] })));
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.messages.at(-1)).toEqual({ role: "tool", tool_call_id: "call", content: [
      { type: "text", text: "page 2" }, { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=", detail: "high" } },
    ] });
  });
  it("resolves credentials when each run starts", async () => {
    const credentials: { apiKey: string | undefined } = { apiKey: undefined };
    const fetchMock = vi.fn(async () => new Response(sse("data: [DONE]\n\n"), { status: 200 }));
    const adapter = createDeepSeekModelAdapter({
      resolveSettings: async () => ({
        apiKey: credentials.apiKey,
        baseUrl: "https://api.deepseek.com",
        defaultModel: "deepseek-v4-flash",
      }),
      fetch: fetchMock as unknown as typeof fetch,
    });
    credentials.apiKey = "sk-runtime";

    await drain(adapter.stream(makeRequest({
      runId: "run_1",
      agentId: "agent_1",
      messages: [{ role: "user", content: "hello" }],
    })));

    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({ authorization: "Bearer sk-runtime" }),
    }));
  });

  it("reports a controlled configuration error without an API key", async () => {
    const adapter = createDeepSeekModelAdapter({
      resolveSettings: async () => ({
        apiKey: undefined,
        baseUrl: "https://api.deepseek.com",
        defaultModel: "deepseek-v4-flash",
      }),
    });

    await expect(drain(adapter.stream(makeRequest({
      runId: "run_1",
      agentId: "agent_1",
      messages: [{ role: "user", content: "hello" }],
    })))).rejects.toThrow("请先在 AI 设置中配置 API Key");
  });

  it("streams reasoning and assistant deltas from DeepSeek SSE chunks", async () => {
    const fetchMock = vi.fn(async () => new Response(sse([
      'data: {"choices":[{"delta":{"reasoning_content":"think"}}]}',
      "",
      'data: {"choices":[{"delta":{"content":"answer"}}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n")), { status: 200 }));
    const adapter = createDeepSeekModelAdapter({
      resolveSettings: async () => ({
        apiKey: "test-key",
        baseUrl: "https://api.deepseek.com",
        defaultModel: "deepseek-v4-flash",
      }),
      fetch: fetchMock as unknown as typeof fetch,
    });

    const events = [];
    for await (const event of adapter.stream(makeRequest({
      runId: "run_1",
      agentId: "agent_1",
      messages: [{ role: "user", content: "hello" }],
    }))) {
      events.push(event);
    }

    expect(fetchMock).toHaveBeenCalledWith("https://api.deepseek.com/chat/completions", expect.objectContaining({
      method: "POST",
    }));
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).model).toBe("deepseek-v4-flash");
    expect(events).toEqual([
      { type: "first_token" },
      { type: "reasoning_summary_delta", summaryId: "run_1:reasoning", delta: "think" },
      { type: "assistant_delta", messageId: "run_1:assistant", delta: "answer" },
      { type: "final", output: { model: "deepseek-v4-flash", empty: false } },
    ]);
  });

  it("rejects a disconnected stream instead of emitting a successful final event", async () => {
    const fetchMock = vi.fn(async () => new Response(sse('data: {"choices":[{"delta":{"content":"unfinished"}}]}\n\n'), { status: 200 }));
    const adapter = createDeepSeekModelAdapter({ resolveSettings: () => ({ apiKey: "test-key", baseUrl: "https://api.deepseek.com", defaultModel: "deepseek-flash" }), fetch: fetchMock as unknown as typeof fetch });
    const events = [];
    const collect = async () => { for await (const event of adapter.stream(makeRequest({ runId: "broken", agentId: "agent", messages: [] }))) events.push(event); };
    await expect(collect()).rejects.toThrow("completion marker");
    expect(events.some((event) => event.type === "final")).toBe(false);
  });

  it.each([false, true])("classifies a terminated stream safely, with partial output=%s", async (partial) => {
    let sent = false;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) {
      if (partial && !sent) {
        sent = true;
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
      } else controller.error(new TypeError("terminated test-secret-key", { cause: { code: "UND_ERR_SOCKET", address: "private" } }));
    } }, { highWaterMark: 0 });
    const adapter = createDeepSeekModelAdapter({ resolveSettings: () => ({ apiKey: "test-secret-key", defaultModel: "deepseek-flash", baseUrl: undefined }),
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(stream)) });
    const events = [];
    const collect = async () => { for await (const event of adapter.stream(makeRequest({ runId: "transport", agentId: "a", messages: [] }))) events.push(event); };
    await expect(collect()).rejects.toMatchObject({ retryable: true, message: "DeepSeek 响应连接中断（UND_ERR_SOCKET），请检查网络后继续任务。" });
    expect(events.some((event) => event.type === "assistant_delta")).toBe(partial);
    expect(events.some((event) => event.type === "final")).toBe(false);
  });

  it("preserves stream cancellation as cancellation", async () => {
    const abort = new DOMException("canceled", "AbortError");
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.error(abort); } });
    const adapter = createDeepSeekModelAdapter({ resolveSettings: () => ({ apiKey: "test", defaultModel: "deepseek-flash", baseUrl: undefined }),
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(stream)) });
    await expect(drain(adapter.stream(makeRequest({ runId: "cancel", agentId: "a", messages: [] })))).rejects.toBe(abort);
  });

  it("sets the summary output budget and identifies a truncated provider response", async () => {
    const fetchMock = vi.fn(async () => new Response(sse([
      'data: {"choices":[{"delta":{"content":"partial handoff"},"finish_reason":"length"}]}',
      "", "data: [DONE]", "",
    ].join("\n")), { status: 200 }));
    const adapter = createDeepSeekModelAdapter({ resolveSettings: () => ({ apiKey: "test-key", baseUrl: "https://api.deepseek.com", defaultModel: "deepseek-flash" }), fetch: fetchMock as unknown as typeof fetch });
    const request = makeRequest({ runId: "summary", agentId: "agent", messages: [{ role: "user", content: "Summarize" }] });
    request.maxOutputTokens = 256; request.purpose = "compaction";
    const events = [];
    for await (const event of adapter.stream(request)) events.push(event);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).max_tokens).toBe(256);
    expect(events[events.length - 1]).toMatchObject({ type: "final", incomplete: true });
  });

  it("keeps supplied workspace data after the conversation and out of the stable system prefix", async () => {
    const fetchMock = vi.fn(async () => new Response(sse([
      'data: {"choices":[{"delta":{"content":"checked"}}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n")), { status: 200 }));
    const adapter = createDeepSeekModelAdapter({
      resolveSettings: async () => ({
        apiKey: "test-key",
        baseUrl: "https://api.deepseek.com",
        defaultModel: "deepseek-v4-flash",
      }),
      fetch: fetchMock as unknown as typeof fetch,
    });
    const messages: HarnessModelMessage[] = [
      {
        role: "system",
        content: [
          "Current active resume canvas:",
          "  document_id: doc_1",
          "  title: Sample Resume",
          "  content:",
          "    Frontend lead / AI application developer",
        ].join("\n"),
      },
      { role: "user", content: "Check this resume." },
    ];
    const skillContext = makeSkillContext({
      allowedToolNames: ["typedance.context.read"],
      toolNames: ["typedance.context.read"],
    });

    await drain(adapter.stream(makeRequest({
      runId: "run_1",
      agentId: "agent_1",
      messages,
      skillContext,
      availableToolNames: ["typedance.context.read"],
    })));

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const systemMessages = body.messages.filter((message: { role: string }) => message.role === "system");

    expect(systemMessages.every((message: { content: string }) => !message.content.includes("Current active resume canvas"))).toBe(true);
    expect(body.messages.at(-1)).toMatchObject({ role: "user", content: expect.stringContaining("Current active resume canvas") });
    expect(body.messages.at(-1).content).toContain("Sample Resume");
    expect(body.messages.at(-1).content).toContain("Frontend lead / AI application developer");
    expect(body.messages.at(-2)).toEqual({ role: "user", content: "Check this resume." });
    expect(JSON.stringify(body)).not.toContain("Available harness tools: typedance.context.read");
  });

  it("maps harness tools to provider tool calls without leaking provider-safe names", async () => {
    const fetchMock = vi.fn(async () => new Response(sse([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"typedance_context_read","arguments":"{\\"context_id\\":\\"ctx_1\\"}"}}]}}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n")), { status: 200 }));
    const adapter = createDeepSeekModelAdapter({
      resolveSettings: async () => ({
        apiKey: "test-key",
        baseUrl: "https://api.deepseek.com",
        defaultModel: "deepseek-v4-flash",
      }),
      fetch: fetchMock as unknown as typeof fetch,
    });

    const events = [];
    for await (const event of adapter.stream(makeRequest({
      runId: "run_1",
      agentId: "agent_1",
      messages: [{ role: "user", content: "read context" }],
      availableTools: [{
        name: "typedance.context.read",
        origin: "mcp",
        description: "Read a selected context source.",
        inputSchema: {
          type: "object",
          properties: {
            context_id: { type: "string" },
          },
        },
      }],
    }))) {
      events.push(event);
    }

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.tools[0].function.name).toBe("typedance_context_read");
    expect(events).toContainEqual({ type: "tool_call_delta", callId: "call_1", delta: 'typedance_context_read{"context_id":"ctx_1"}' });
    expect(events).toContainEqual({
      type: "tool_call",
      call: {
        id: "call_1",
        name: "typedance.context.read",
        origin: "mcp",
        input: { context_id: "ctx_1" },
      },
    });
  });

  it("uses the caller supplied model instead of an adapter fallback", async () => {
    const fetchMock = vi.fn(async () => new Response(sse("data: [DONE]\n\n"), { status: 200 }));
    const adapter = createDeepSeekModelAdapter({
      resolveSettings: async () => ({
        apiKey: "test-key",
        baseUrl: "https://api.deepseek.com",
        defaultModel: "deepseek-v4-flash",
      }),
      fetch: fetchMock as unknown as typeof fetch,
    });

    await drain(adapter.stream(makeRequest({
      runId: "run_1",
      agentId: "agent_1",
      model: "custom-chat-model",
      messages: [{ role: "user", content: "hello" }],
    })));

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).model).toBe("custom-chat-model");
  });

  it("requires a model from the request or adapter configuration", async () => {
    const adapter = createDeepSeekModelAdapter({
      resolveSettings: async () => ({
        apiKey: "test-key",
        baseUrl: "https://api.deepseek.com",
        defaultModel: undefined,
      }),
      fetch: vi.fn() as unknown as typeof fetch,
    });

    await expect(drain(adapter.stream(makeRequest({
      runId: "run_1",
      agentId: "agent_1",
      messages: [{ role: "user", content: "hello" }],
    })))).rejects.toThrow("DeepSeek model must be provided");
  });
});

function makeRequest(input: {
  runId: string;
  agentId: string;
  messages: HarnessModelMessage[];
  skillContext?: HarnessAgentSkillContext;
  availableToolNames?: string[];
  availableTools?: HarnessModelRequest["availableTools"];
  model?: string;
}): HarnessModelRequest {
  const skillContext = input.skillContext ?? makeSkillContext({});
  return {
    signal: new AbortController().signal,
    runId: input.runId,
    agentId: input.agentId,
    model: input.model,
    capabilityPolicy: { scopeIds: [], pluginIds: [] },
    prompt: buildAgentHostPromptBundle({
      messages: input.messages,
      skillContext,
    }),
    availableToolNames: input.availableToolNames ?? [],
    availableTools: input.availableTools ?? [],
  };
}

function makeSkillContext(input: {
  allowedToolNames?: string[];
  toolNames?: string[];
}): HarnessAgentSkillContext {
  return {
    policy: { scopeIds: [], pluginIds: [] },
    agent: {
      id: "agent_1",
      name: "Agent",
      role: "primary",
      skill_ids: [],
      allowed_tool_names: input.allowedToolNames ?? [],
      pluginId: "plugin_1",
    },
    pluginIds: [],
    pluginInstructions: [],
    skills: [],
    toolNames: input.toolNames ?? [],
  };
}

function sse(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

async function drain(iterable: AsyncIterable<unknown>): Promise<void> {
  for await (const event of iterable) {
    void event;
  }
}
