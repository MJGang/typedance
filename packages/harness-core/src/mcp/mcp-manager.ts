export type HarnessMcpToolDefinition = {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
};

export type HarnessMcpServerRegistration = {
  id: string;
  name: string;
  tools: HarnessMcpToolDefinition[];
  callTool(toolName: string, input: Record<string, unknown>): Promise<unknown> | unknown;
};

export class HarnessMcpManager {
  #servers = new Map<string, HarnessMcpServerRegistration>();
  #toolOwners = new Map<string, string>();

  registerServer(server: HarnessMcpServerRegistration): HarnessMcpServerRegistration {
    for (const tool of server.tools) {
      const owner = this.#toolOwners.get(tool.name);
      if (owner) {
        throw new Error(`MCP tool ${tool.name} is already registered by server ${owner}`);
      }
    }

    this.#servers.set(server.id, server);
    for (const tool of server.tools) {
      this.#toolOwners.set(tool.name, server.id);
    }
    return server;
  }

  getToolServer(toolName: string): HarnessMcpServerRegistration {
    const serverId = this.#toolOwners.get(toolName);
    if (!serverId) {
      throw new Error(`Unknown MCP tool: ${toolName}`);
    }
    const server = this.#servers.get(serverId);
    if (!server) {
      throw new Error(`Unknown MCP server: ${serverId}`);
    }
    return server;
  }

  listServers(): HarnessMcpServerRegistration[] {
    return [...this.#servers.values()];
  }
}
