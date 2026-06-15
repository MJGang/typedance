import { describe, expect, it } from "vitest";
import { createHarnessRuntime } from "../src";

const fixedNow = () => new Date("2026-06-15T08:00:00.000Z");

describe("createHarnessRuntime", () => {
  it("creates runs and records assistant/tool events in sequence", async () => {
    const runtime = createHarnessRuntime({ now: fixedNow });
    runtime.registerTool({
      name: "alpha.readWorkspace",
      origin: "mcp",
      handler: async (input) => ({ workspace_id: input.workspace_id, status: "ready" }),
    });

    const run = runtime.createRun({
      capability_policy: {
        scope_ids: ["workspace:alpha"],
        plugin_ids: ["alpha.agent"],
      },
      user_message: "Inspect this workspace",
      context: { workspace_id: "workspace_1" },
    });

    runtime.appendAssistantDelta(run.id, "msg_1", "I will read the active workspace first.");
    const toolResult = await runtime.invokeTool(run.id, {
      id: "tool_call_1",
      name: "alpha.readWorkspace",
      origin: "mcp",
      input: { workspace_id: "workspace_1" },
    });

    expect(toolResult.status).toBe("completed");
    expect(runtime.getEvents(run.id).map((event) => event.type)).toEqual([
      "run.started",
      "assistant.delta",
      "tool.call.started",
      "tool.call.completed",
    ]);
    expect(runtime.getEvents(run.id).map((event) => event.sequence)).toEqual([0, 1, 2, 3]);
  });

  it("requests permission before invoking guarded tools", async () => {
    const runtime = createHarnessRuntime({ now: fixedNow });
    runtime.registerTool({
      name: "workspace.readFile",
      origin: "workspace",
      requiresPermission: (input) => ({
        kind: "filesystem.read",
        reason: "Read a user-authorized local file.",
        scope: {
          uri: String(input.uri),
          access: "read",
        },
      }),
      handler: async () => ({ text: "workspace content" }),
    });

    const run = runtime.createRun({
      user_message: "Read attachment",
    });

    const result = await runtime.invokeTool(run.id, {
      id: "tool_call_1",
      name: "workspace.readFile",
      origin: "workspace",
      input: { uri: "file:///C:/Users/test/Documents/workspace.txt" },
    });

    expect(result.status).toBe("permission_required");
    expect(runtime.getEvents(run.id).map((event) => event.type)).toEqual([
      "run.started",
      "permission.requested",
    ]);
  });

  it("resolves plugins from an explicit capability policy", () => {
    const runtime = createHarnessRuntime({ now: fixedNow });
    runtime.registerPlugin({
      id: "alpha.agent",
      name: "Alpha Agent",
      version: "0.1.0",
      module_format: "esm",
      scopes: ["workspace:alpha"],
    });
    runtime.registerPlugin({
      id: "beta.agent",
      name: "Beta Agent",
      version: "0.1.0",
      module_format: "esm",
      scopes: ["workspace:beta"],
    });

    expect(runtime.resolvePluginsForPolicy({ scopeIds: ["workspace:alpha"] }).map((plugin) => plugin.id)).toEqual([
      "alpha.agent",
    ]);
    expect(runtime.resolvePluginsForPolicy({ scopeIds: ["workspace:missing"] })).toEqual([]);
    expect(runtime.resolvePluginsForPolicy({ pluginIds: ["beta.agent"] }).map((plugin) => plugin.id)).toEqual([
      "beta.agent",
    ]);
    expect(runtime.resolvePluginsForPolicy({ scopeIds: ["workspace:alpha"], pluginIds: ["beta.agent"] })).toEqual([
      expect.objectContaining({ id: "beta.agent" }),
    ]);
  });
});
