import { describe, expect, it } from "vitest";
import type { HarnessModelMessage, HarnessModelRequest } from "@typedance/harness-core";
import { createDeepSeekModelAdapter } from "../src/model/deepseek";
import { buildAgentHostPromptBundle } from "../src/prompt";

describe("createDeepSeekModelAdapter", () => {
  it("uses a changed reasoning setting on the next call of the same run without changing its model", async () => {
    let effort = "high" as "high" | "low";
    const bodies: Record<string, unknown>[] = [];
    const adapter = createDeepSeekModelAdapter({
      resolveSettings: () => ({ apiKey: "test", baseUrl: undefined, defaultModel: "deepseek-v4-pro", reasoningEffort: effort }),
      fetch: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(sse('data: {"type":"response.completed","response":{"output":[]}}\n\n'));
      },
    });
    const request = { ...makeRequest(), model: "deepseek-flash" };
    await collect(adapter.stream(request));
    effort = "low";
    await collect(adapter.stream(request));
    expect(bodies.map((body) => [body.model, body.reasoning])).toEqual([["deepseek-flash", { effort: "high" }], ["deepseek-flash", { effort: "low" }]]);
  });
  it.each(["off", "low", "high", "max"] as const)("sends the selected %s effort and requests authoritative usage", async (effort) => {
    let body: Record<string, unknown> = {};
    const adapter = createDeepSeekModelAdapter({
      resolveSettings: () => ({ apiKey: "test", baseUrl: undefined, defaultModel: "deepseek-flash", reasoningEffort: "high" }),
      fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(sseResponses([
          { type: "response.output_text.delta", delta: "ok" },
          { type: "response.completed", response: { output: [], usage: {
            input_tokens: 100, output_tokens: 20, total_tokens: 120,
            input_tokens_details: { cached_tokens: 80 }, output_tokens_details: { reasoning_tokens: 10 },
          } } },
        ]));
      },
    });
    const events = [];
    for await (const event of adapter.stream({ ...makeRequest(), modelOptions: { reasoningEffort: effort } })) events.push(event);
    expect(body).toMatchObject({ reasoning: { effort: effort === "off" ? "none" : effort }, stream: true });
    expect(body).not.toHaveProperty("stream_options");
    expect(events[0]).toEqual({ type: "first_token" });
    expect(events.at(-1)).toMatchObject({ type: "final", usage: {
      inputTokens: 100, outputTokens: 20, totalTokens: 120, cacheReadInputTokens: 80, cacheMissInputTokens: 20, reasoningOutputTokens: 10,
    } });
  });
  it("sends harness skill instructions through the provider request", async () => {
    let body: unknown;
    const adapter = createDeepSeekModelAdapter({
      resolveSettings: async () => ({
        apiKey: "test-key",
        baseUrl: "https://api.deepseek.com",
        defaultModel: undefined,
      }),
      fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(sseResponses([{ type: "response.completed", response: { output: [] } }]), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      },
    });

    await collect(adapter.stream(makeRequest()));

    const messages = (body as { input: Array<{ role: string; content: string }> }).input;
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain("Use resume workspace facts before answering.");
    expect(messages[0]?.content).not.toContain("Current active resume canvas:");
    expect(messages.at(-1)?.content).toContain("Current active resume canvas:");
    expect(messages).toContainEqual({
      type: "message",
      role: "user",
      content: "Please review this resume.",
    });
  });

  it("defaults to /responses, streams reasoning and function arguments, and replays tool results with images", async () => {
    const functionCall = { type: "function_call", id: "output-1", call_id: "call-1", name: "resume_read", arguments: '{"page":1}', status: "completed" };
    const bodies: Record<string, unknown>[] = [];
    const adapter = createDeepSeekModelAdapter({
      resolveSettings: () => ({ apiKey: "test", baseUrl: undefined, defaultModel: "deepseek-flash" }),
      fetch: async (url, init) => {
        expect(url).toBe("https://api.deepseek.com/responses");
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(sseResponses(bodies.length === 1 ? [
          { type: "response.reasoning_text.delta", delta: "Need page 1" },
          { type: "response.output_item.added", item: { ...functionCall, arguments: "", status: "in_progress" } },
          { type: "response.function_call_arguments.delta", item_id: "output-1", delta: '{"page":1}' },
          { type: "response.output_item.done", item: functionCall },
          { type: "response.completed", response: { output: [functionCall] } },
        ] : [
          { type: "response.output_text.delta", delta: "Checked" },
          { type: "response.completed", response: { output: [] } },
        ]));
      },
    });
    const image = { type: "image_url" as const, image_url: "data:image/png;base64,AA==", detail: "low" as const };
    const request = makeRequest();
    request.prompt.conversation = [{ role: "user", content: [{ type: "text", text: "Review" }, image] }];
    request.availableTools = [{ name: "resume.read", origin: "plugin", description: "Read a page" }];
    request.maxOutputTokens = 4096;
    const first = await collect(adapter.stream(request));
    expect(first).toEqual([
      { type: "first_token" },
      { type: "reasoning_summary_delta", summaryId: "run-1:reasoning", delta: "Need page 1" },
      { type: "tool_call_delta", callId: "call-1", delta: "resume_read" },
      { type: "tool_call_delta", callId: "call-1", delta: '{"page":1}' },
      { type: "tool_call", call: { id: "call-1", name: "resume.read", origin: "plugin", input: { page: 1 } } },
      { type: "final", output: { model: request.model, empty: true } },
    ]);
    const call = first.find((event) => event.type === "tool_call")!.call;
    request.prompt.conversation.push(
      { role: "assistant", content: "", reasoningContent: "Need page 1", toolCalls: [call] },
      { role: "tool", toolCallId: call.id, content: [{ type: "text", text: "Page 1" }, image] },
    );
    expect(await collect(adapter.stream(request))).toContainEqual({ type: "assistant_delta", messageId: "run-1:assistant", delta: "Checked" });
    const imagePart = { type: "input_image", image_url: image.image_url, detail: "low" };
    expect(bodies[0]).toMatchObject({
      max_output_tokens: 4096, store: false, tools: [{ type: "function", name: "resume_read", strict: false }],
    });
    expect(bodies[0].input).toContainEqual({ type: "message", role: "user", content: [{ type: "input_text", text: "Review" }, imagePart] });
    expect(bodies[1].input).toEqual(expect.arrayContaining([
      { type: "reasoning", content: [{ type: "reasoning_text", text: "Need page 1" }] },
      { type: "function_call", call_id: "call-1", name: "resume_read", arguments: '{"page":1}' },
      { type: "function_call_output", call_id: "call-1", output: [{ type: "input_text", text: "Page 1" }, imagePart] },
    ]));
  });

  it("marks an incomplete response without executing its partial tool calls", async () => {
    const adapter = createDeepSeekModelAdapter({
      resolveSettings: () => ({ apiKey: "test", baseUrl: undefined, defaultModel: "deepseek-flash" }),
      fetch: async () => new Response(sseResponses([
        { type: "response.incomplete", response: { output: [{ type: "function_call", call_id: "partial", name: "inspect", arguments: "{" }] } },
      ])),
    });
    expect(await collect(adapter.stream(makeRequest()))).toEqual([
      { type: "final", output: { model: "deepseek-v4-flash", empty: true }, incomplete: true },
    ]);
  });

  it.each([
    { event: { type: "response.failed", response: { error: { code: "server_error", message: "echo test-secret" } } }, message: "DeepSeek responses failed: echo [redacted]" },
    { event: { type: "response.in_progress" }, message: "DeepSeek Responses stream ended before its final event" },
  ])("rejects an unsuccessful Responses stream without a final result", async ({ event, message }) => {
    const adapter = createDeepSeekModelAdapter({
      resolveSettings: () => ({ apiKey: "test-secret", baseUrl: undefined, defaultModel: "deepseek-flash" }),
      fetch: async () => new Response(sseResponses([event])),
    });
    await expect(collect(adapter.stream(makeRequest()))).rejects.toMatchObject({ retryable: true, message });
  });
});

function makeRequest(): HarnessModelRequest {
  const messages: HarnessModelMessage[] = [
    {
      role: "system",
      content: "Current active resume canvas:\n  content:\n    Experience text",
    },
    {
      role: "user",
      content: "Please review this resume.",
    },
  ];
  const skillContext = {
    policy: {
      scopeIds: ["pack:resume"],
      pluginIds: [],
    },
    agent: {
      id: "typedance.resume.primary",
      pluginId: "typedance.resume.agent",
      name: "Resume Agent",
      role: "primary" as const,
      description: "Resume agent",
      skill_ids: ["typedance.resume.context"],
      allowed_tool_names: [],
    },
    pluginIds: ["typedance.resume.agent"],
    pluginInstructions: [
      {
        pluginId: "typedance.resume.agent",
        path: "instructions.md",
        content: "Use resume workspace facts before answering.",
      },
    ],
    skills: [],
    toolNames: [],
  };
  return {
    signal: new AbortController().signal,
    runId: "run-1",
    capabilityPolicy: {
      scopeIds: ["pack:resume"],
      pluginIds: [],
    },
    agentId: "typedance.resume.primary",
    model: "deepseek-v4-flash",
    prompt: buildAgentHostPromptBundle({
      messages,
      skillContext,
    }),
    availableToolNames: [],
    availableTools: [],
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

function sseResponses(events: Array<{ type: string } & Record<string, unknown>>): ReadableStream<Uint8Array> {
  return sse(events.map((event) => `event: ${event.type}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`).join(""));
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}
