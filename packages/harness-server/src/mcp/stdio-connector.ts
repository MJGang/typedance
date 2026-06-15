import type { HarnessMcpServerDefinition } from "@typedance/harness-contracts";
import type { HarnessMcpServerRegistration } from "@typedance/harness-core";

export type HarnessMcpSdkTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
};

export type HarnessMcpSdkClient = {
  listTools(): Promise<{ tools: HarnessMcpSdkTool[] }>;
  callTool(input: { name: string; arguments?: Record<string, unknown> }): Promise<unknown>;
  close?(): Promise<void>;
};

export type HarnessMcpSdkClientFactory = (server: HarnessMcpServerDefinition) => Promise<HarnessMcpSdkClient>;

export type HarnessMcpStdioConnectorInput = {
  server: HarnessMcpServerDefinition;
  toolNames?: string[];
  clientFactory?: HarnessMcpSdkClientFactory;
};

export async function createMcpStdioServerRegistration(
  input: HarnessMcpStdioConnectorInput
): Promise<HarnessMcpServerRegistration> {
  if (input.server.transport !== "stdio") {
    throw new Error(`MCP server ${input.server.id} must use stdio transport`);
  }

  const client = await (input.clientFactory ?? createDefaultSdkClient)(input.server);
  const listed = await client.listTools();
  const availableTools = new Map(listed.tools.map((tool) => [tool.name, tool]));
  const toolNames = input.toolNames?.length ? input.toolNames : [...availableTools.keys()];
  const tools = toolNames.map((name) => {
    const tool = availableTools.get(name);
    if (!tool) {
      throw new Error(`MCP server ${input.server.id} did not expose declared tool ${name}`);
    }
    return {
      name,
      description: tool.description ?? `MCP tool ${name}`,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
    };
  });

  return {
    id: input.server.id,
    name: input.server.name,
    tools,
    callTool: async (toolName, toolInput) => normalizeMcpToolResult(
      await client.callTool({
        name: toolName,
        arguments: toolInput,
      })
    ),
  };
}

async function createDefaultSdkClient(server: HarnessMcpServerDefinition): Promise<HarnessMcpSdkClient> {
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/stdio.js"),
  ]);
  const client = new Client({
    name: "harness-system",
    version: "0.1.0",
  });
  const transport = new StdioClientTransport({
    command: server.command ?? "python",
    args: server.args,
    env: stringEnv({
      ...process.env,
      ...server.env,
    }),
  });
  await client.connect(transport);
  return client as HarnessMcpSdkClient;
}

function stringEnv(input: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

function normalizeMcpToolResult(result: unknown): unknown {
  if (!result || typeof result !== "object") {
    return result;
  }

  const record = result as Record<string, unknown>;
  if ("structuredContent" in record && record.structuredContent !== undefined) {
    return record.structuredContent;
  }
  if ("content" in record) {
    return { content: record.content };
  }
  return result;
}
