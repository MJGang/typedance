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
          name: "alpha.readWorkspace",
          description: "Read workspace",
        },
      ],
      callTool: async (toolName, input) => {
        calls.push({ toolName, input });
        return { workspace_id: input.workspace_id, status: "ready" };
      },
    });

    const run = runtime.createRun({
      user_message: "Read workspace",
    });

    const result = await runtime.invokeTool(run.id, {
      id: "tool_call_1",
      name: "alpha.readWorkspace",
      origin: "mcp",
      input: { workspace_id: "workspace_1" },
    });

    expect(result.status).toBe("completed");
    expect(calls).toEqual([{ toolName: "alpha.readWorkspace", input: { workspace_id: "workspace_1" } }]);
  });

  it("rejects duplicate MCP tool names across servers", () => {
    const runtime = createHarnessRuntime();
    runtime.registerMcpServer({
      id: "alpha.mcp",
      name: "Alpha MCP",
      tools: [{ name: "alpha.readWorkspace", description: "Read workspace" }],
      callTool: async () => ({}),
    });

    expect(() =>
      runtime.registerMcpServer({
        id: "alpha.remote",
        name: "Alpha Remote MCP",
        tools: [{ name: "alpha.readWorkspace", description: "Duplicate tool" }],
        callTool: async () => ({}),
      })
    ).toThrow("MCP tool alpha.readWorkspace is already registered by server alpha.mcp");
  });
});
