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

  it("refuses pro models", () => {
    expect(() => assertFlashModel("deepseek-v4-pro")).toThrow("Refusing to use non-flash");
  });
});
