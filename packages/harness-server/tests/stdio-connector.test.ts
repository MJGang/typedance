import { describe, expect, it } from "vitest";
import { createMcpStdioServerRegistration } from "../src";

describe("createMcpStdioServerRegistration", () => {
  it("creates a Harness MCP registration from SDK tools", async () => {
    const registration = await createMcpStdioServerRegistration({
      server: {
        id: "alpha.mcp",
        name: "Alpha MCP",
        transport: "stdio",
        command: "node",
        args: ["server.js"],
      },
      toolNames: ["alpha.readContext"],
      clientFactory: async () => ({
        listTools: async () => ({
          tools: [
            {
              name: "alpha.readContext",
              description: "Read context",
            },
          ],
        }),
        callTool: async ({ name, arguments: input }) => ({
          structuredContent: {
            name,
            input,
          },
        }),
      }),
    });

    expect(registration.tools).toEqual([
      {
        name: "alpha.readContext",
        description: "Read context",
        inputSchema: undefined,
        outputSchema: undefined,
      },
    ]);
    await expect(registration.callTool("alpha.readContext", { context_id: "context_1" })).resolves.toEqual({
      name: "alpha.readContext",
      input: { context_id: "context_1" },
    });
  });

  it("rejects manifest-declared tools missing from the MCP server", async () => {
    await expect(
      createMcpStdioServerRegistration({
        server: {
          id: "alpha.mcp",
          name: "Alpha MCP",
          transport: "stdio",
          command: "node",
          args: ["server.js"],
        },
        toolNames: ["alpha.readContext"],
        clientFactory: async () => ({
          listTools: async () => ({ tools: [] }),
          callTool: async () => ({}),
        }),
      })
    ).rejects.toThrow("MCP server alpha.mcp did not expose declared tool alpha.readContext");
  });
});
