import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createHarnessRuntime, HarnessPluginFileLoader, HarnessPluginInstaller } from "../src";

describe("HarnessPluginInstaller", () => {
  it("installs a plugin, loads skill files, and registers declared MCP tools", async () => {
    const root = await mkdtemp(join(tmpdir(), "harness-plugin-"));
    const pluginDir = join(root, "alpha");
    await mkdir(join(pluginDir, "skills"), { recursive: true });
    await writeFile(
      join(pluginDir, "plugin.json"),
      JSON.stringify({
        id: "alpha.agent",
        name: "Alpha Agent",
        version: "0.1.0",
        module_format: "esm",
        scopes: ["context:alpha"],
        skills: [
          {
            id: "alpha.context",
            name: "Context Reader",
            description: "Read the active context.",
            instruction_files: ["skills/context.md"],
            tool_names: ["alpha.readContext"],
          },
        ],
        agents: [
          {
            id: "alpha.primary",
            name: "Alpha Primary Agent",
            role: "primary",
            skill_ids: ["alpha.context"],
          },
        ],
        mcp_servers: [
          {
            id: "alpha.mcp",
            name: "Alpha MCP",
            transport: "stdio",
            command: "node",
            args: ["server.js"],
          },
        ],
      }),
      "utf8"
    );
    await writeFile(join(pluginDir, "skills", "context.md"), "Read context state before acting.", "utf8");

    const loader = new HarnessPluginFileLoader(root);
    const runtime = createHarnessRuntime({
      skillContentLoader: loader.createSkillContentLoader(),
    });
    const installer = new HarnessPluginInstaller({
      pluginLoader: loader,
      createMcpServer: ({ server, toolNames }) => ({
        id: server.id,
        name: server.name,
        tools: toolNames.map((name) => ({ name, description: `Tool ${name}` })),
        callTool: async (toolName, input) => ({ toolName, input }),
      }),
    });

    await installer.installPlugin(runtime, "alpha");

    const context = await runtime.buildAgentSkillContext({
      policy: { scopeIds: ["context:alpha"] },
      agentId: "alpha.primary",
    });
    expect(context.skills.map((skill) => skill.id)).toEqual(["alpha.context"]);

    const run = runtime.createRun({
      capability_policy: { scope_ids: ["context:alpha"] },
      user_message: "Read context",
    });
    const result = await runtime.invokeAgentTool({
      runId: run.id,
      agentId: "alpha.primary",
      call: {
        id: "tool_call_1",
        name: "alpha.readContext",
        origin: "mcp",
        input: { context_id: "context_1" },
      },
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") {
      throw new Error("expected completed result");
    }
    expect(result.result.output).toEqual({
      toolName: "alpha.readContext",
      input: { context_id: "context_1" },
    });
  });
});
