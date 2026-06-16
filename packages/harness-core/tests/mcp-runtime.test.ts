import { describe, expect, it } from "vitest";
import { createHarnessRuntime } from "../src";

describe("harness MCP runtime", () => {
  it("registers MCP server tools and routes tool calls through the MCP adapter", async () => {
    const calls: Array<{ toolName: string; input: Record<string, unknown> }> = [];
    const runtime = createHarnessRuntime();
    runtime.registerMcpServer({
      id: "alpha.mcp",
      name: "Alpha MCP",
      tools: [
        {
          name: "alpha.readContext",
          description: "Read context",
        },
      ],
      callTool: async (toolName, input) => {
        calls.push({ toolName, input });
        return { context_id: input.context_id, status: "ready" };
      },
    });

    const run = runtime.createRun({
      user_message: "Read context",
    });

    const result = await runtime.invokeTool(run.id, {
      id: "tool_call_1",
      name: "alpha.readContext",
      origin: "mcp",
      input: { context_id: "context_1" },
    });

    expect(result.status).toBe("completed");
    expect(calls).toEqual([{ toolName: "alpha.readContext", input: { context_id: "context_1" } }]);
  });

  it("rejects duplicate MCP tool names across servers", () => {
    const runtime = createHarnessRuntime();
    runtime.registerMcpServer({
      id: "alpha.mcp",
      name: "Alpha MCP",
      tools: [{ name: "alpha.readContext", description: "Read context" }],
      callTool: async () => ({}),
    });

    expect(() =>
      runtime.registerMcpServer({
        id: "alpha.remote",
        name: "Alpha Remote MCP",
        tools: [{ name: "alpha.readContext", description: "Duplicate tool" }],
        callTool: async () => ({}),
      })
    ).toThrow("MCP tool alpha.readContext is already registered by server alpha.mcp");
  });
});
