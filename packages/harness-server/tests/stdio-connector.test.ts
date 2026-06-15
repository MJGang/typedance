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
      toolNames: ["alpha.readWorkspace"],
      clientFactory: async () => ({
        listTools: async () => ({
          tools: [
            {
              name: "alpha.readWorkspace",
              description: "Read workspace",
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
        name: "alpha.readWorkspace",
        description: "Read workspace",
        inputSchema: undefined,
        outputSchema: undefined,
      },
    ]);
    await expect(registration.callTool("alpha.readWorkspace", { workspace_id: "workspace_1" })).resolves.toEqual({
      name: "alpha.readWorkspace",
      input: { workspace_id: "workspace_1" },
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
        toolNames: ["alpha.readWorkspace"],
        clientFactory: async () => ({
          listTools: async () => ({ tools: [] }),
          callTool: async () => ({}),
        }),
      })
    ).rejects.toThrow("MCP server alpha.mcp did not expose declared tool alpha.readWorkspace");
  });
});
