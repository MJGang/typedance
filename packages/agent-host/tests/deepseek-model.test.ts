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
  it("resolves credentials when each run starts", async () => {
    let apiKey: string | undefined;
    const fetchMock = vi.fn(async () => new Response(sse("data: [DONE]\n\n"), { status: 200 }));
    const adapter = createDeepSeekModelAdapter({
      resolveSettings: async () => ({
        apiKey,
        baseUrl: "https://api.deepseek.com",
        defaultModel: "deepseek-v4-flash",
      }),
      fetch: fetchMock as unknown as typeof fetch,
    });
    apiKey = "sk-runtime";

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
      { type: "reasoning_summary_delta", summaryId: "run_1:reasoning", delta: "think" },
      { type: "assistant_delta", messageId: "run_1:assistant", delta: "answer" },
      { type: "final", output: { model: "deepseek-v4-flash", empty: false } },
    ]);
  });

  it("maps supplied workspace evidence into the first system message without advertising unavailable tools", async () => {
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

    for await (const _event of adapter.stream(makeRequest({
      runId: "run_1",
      agentId: "agent_1",
      messages,
      skillContext,
      availableToolNames: ["typedance.context.read"],
    }))) {
      // Drain the stream so the request is sent.
    }

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const systemMessages = body.messages.filter((message: { role: string }) => message.role === "system");

    expect(systemMessages).toHaveLength(1);
    expect(systemMessages[0].content).toContain("Current active resume canvas");
    expect(systemMessages[0].content).toContain("Sample Resume");
    expect(systemMessages[0].content).toContain("Frontend lead / AI application developer");
    expect(systemMessages[0].content).not.toContain("Available harness tools: typedance.context.read");
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "Check this resume." });
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
  for await (const _event of iterable) {
    // Consume stream.
  }
}
