import { describe, expect, it } from "vitest";
import type { HarnessModelMessage, HarnessModelRequest } from "@typedance/harness-core";
import { createDeepSeekModelAdapter } from "../src/model/deepseek";
import { buildAgentHostPromptBundle } from "../src/prompt";

describe("createDeepSeekModelAdapter", () => {
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
