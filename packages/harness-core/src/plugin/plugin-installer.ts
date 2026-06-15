import type { HarnessMcpServerDefinition, HarnessPluginManifest } from "@typedance/harness-contracts";
import type { HarnessRuntime } from "../runtime";
import type { HarnessMcpServerRegistration } from "../mcp/mcp-manager";
import type { HarnessPluginFileLoader } from "./plugin-file-loader";

export type HarnessPluginMcpConnectorInput = {
  plugin: HarnessPluginManifest;
  server: HarnessMcpServerDefinition;
  toolNames: string[];
};

export type HarnessPluginInstallerOptions = {
  pluginLoader: HarnessPluginFileLoader;
  createMcpServer(input: HarnessPluginMcpConnectorInput): HarnessMcpServerRegistration | Promise<HarnessMcpServerRegistration>;
};

export class HarnessPluginInstaller {
  #createMcpServer: HarnessPluginInstallerOptions["createMcpServer"];
  #pluginLoader: HarnessPluginFileLoader;

  constructor(options: HarnessPluginInstallerOptions) {
    this.#pluginLoader = options.pluginLoader;
    this.#createMcpServer = options.createMcpServer;
  }

  async installPlugin(runtime: HarnessRuntime, directoryName: string): Promise<HarnessPluginManifest> {
    const plugin = await this.#pluginLoader.loadPlugin(directoryName);
    runtime.registerPlugin(plugin);

    const toolNames = this.#toolNames(plugin);
    for (const server of plugin.mcp_servers) {
      runtime.registerMcpServer(
        await this.#createMcpServer({
          plugin,
          server,
          toolNames,
        })
      );
    }

    return plugin;
  }

  #toolNames(plugin: HarnessPluginManifest): string[] {
    return [...new Set(plugin.skills.flatMap((skill) => skill.tool_names))];
  }
}
