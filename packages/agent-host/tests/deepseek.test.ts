import { describe, expect, it } from "vitest";
import type { HarnessModelMessage, HarnessModelRequest } from "@typedance/harness-core";
import { createDeepSeekModelAdapter } from "../src/model/deepseek";
import { buildAgentHostPromptBundle } from "../src/prompt";

describe("createDeepSeekModelAdapter", () => {
  it.each(["off", "low", "high", "max"] as const)("sends the selected %s effort and requests authoritative usage", async (effort) => {
    let body: Record<string, unknown> = {};
    const adapter = createDeepSeekModelAdapter({
      resolveSettings: () => ({ apiKey: "test", baseUrl: undefined, defaultModel: "deepseek-flash", reasoningEffort: "high" }),
      fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(sse('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call","function":{"name":"inspect","arguments":"{}"}}]}}]}\n\ndata: {"usage":{"prompt_tokens":100,"completion_tokens":20,"prompt_cache_hit_tokens":80},"choices":[]}\n\ndata: [DONE]\n\n'), { status: 200 });
      },
    });
    const events = [];
    for await (const event of adapter.stream({ ...makeRequest(), modelOptions: { reasoningEffort: effort } })) events.push(event);
    expect(body).toMatchObject({ thinking: { type: effort === "off" ? "disabled" : "enabled" }, reasoning_effort: effort === "off" ? "none" : effort, stream_options: { include_usage: true } });
    expect(events[0]).toEqual({ type: "first_token" });
    expect(events.at(-1)).toMatchObject({ type: "final", usage: { inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 80 } });
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
        return new Response(sse("data: [DONE]\n\n"), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      },
    });

    await drain(adapter.stream(makeRequest()));

    const messages = (body as { messages: Array<{ role: string; content: string }> }).messages;
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain("Use resume workspace facts before answering.");
    expect(messages[0]?.content).toContain("Current active resume canvas:");
    expect(messages).toContainEqual({
      role: "user",
      content: "Please review this resume.",
    });
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

async function drain(iterable: AsyncIterable<unknown>): Promise<void> {
  for await (const _event of iterable) {
    // Consume stream.
  }
}
