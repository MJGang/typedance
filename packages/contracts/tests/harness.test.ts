import { describe, expect, it } from "vitest";
import {
  harnessCapabilityPolicySchema,
  harnessPermissionDecisionSchema,
  harnessPermissionRequestSchema,
  harnessPluginManifestSchema,
  harnessRunRequestSchema,
  harnessRunSchema,
  harnessRunEventSchema,
  harnessToolCallSchema,
} from "../src";

const timestamp = "2026-06-15T08:00:00.000Z";

describe("harness run event schemas", () => {
  it("models run capability boundaries without pack fields", () => {
    const policy = harnessCapabilityPolicySchema.parse({
      scope_ids: ["context:alpha"],
      plugin_ids: ["alpha.agent"],
    });
    const request = harnessRunRequestSchema.parse({
      capability_policy: policy,
      user_message: "Inspect this context",
    });
    const run = harnessRunSchema.parse({
      id: "run_1",
      capability_policy: request.capability_policy,
      status: "running",
      created_at: timestamp,
      updated_at: timestamp,
    });
    const started = harnessRunEventSchema.parse({
      id: "evt_1",
      run_id: run.id,
      sequence: 0,
      type: "run.started",
      created_at: timestamp,
      capability_policy: policy,
      input: { user_message: request.user_message },
    });

    expect(run).not.toHaveProperty(["pack", "id"].join("_"));
    expect(started).not.toHaveProperty(["pack", "id"].join("_"));
    expect(started.capability_policy.scope_ids).toEqual(["context:alpha"]);
  });

  it("validates streaming assistant, reasoning, tool, and completion events", () => {
    const assistantDelta = harnessRunEventSchema.parse({
      id: "evt_1",
      run_id: "run_1",
      sequence: 1,
      type: "assistant.delta",
      created_at: timestamp,
      message_id: "msg_1",
      delta: "我会先读取当前简历。",
    });

    const reasoningDelta = harnessRunEventSchema.parse({
      id: "evt_2",
      run_id: "run_1",
      sequence: 2,
      type: "reasoning.summary.delta",
      created_at: timestamp,
      summary_id: "reasoning_1",
      delta: "需要确认事实来源再修改成果描述。",
    });

    const toolStarted = harnessRunEventSchema.parse({
      id: "evt_3",
      run_id: "run_1",
      sequence: 3,
      type: "tool.call.started",
      created_at: timestamp,
      tool_call: {
        id: "tool_call_1",
        name: "resume.getWorkspaceView",
        origin: "mcp",
        input: { document_id: "doc_1" },
      },
    });

    const completed = harnessRunEventSchema.parse({
      id: "evt_4",
      run_id: "run_1",
      sequence: 4,
      type: "run.completed",
      created_at: timestamp,
      output: {
        message_id: "msg_1",
        summary: "已完成检查。",
      },
    });

    expect(assistantDelta.type).toBe("assistant.delta");
    expect(reasoningDelta.type).toBe("reasoning.summary.delta");
    expect(toolStarted.type).toBe("tool.call.started");
    expect(completed.type).toBe("run.completed");
  });

  it("rejects unknown event types", () => {
    expect(() =>
      harnessRunEventSchema.parse({
        id: "evt_unknown",
        run_id: "run_1",
        sequence: 1,
        type: "assistant.raw_chain_of_thought",
        created_at: timestamp,
      })
    ).toThrow();
  });
});

describe("harness plugin manifest schema", () => {
  it("validates a scoped ESM plugin with skills, agents, and MCP servers", () => {
    const manifest = harnessPluginManifestSchema.parse({
      id: "alpha.agent",
      name: "Alpha Agent",
      version: "0.1.0",
      module_format: "esm",
      scopes: ["context:alpha"],
      instructions: ["instructions.md"],
      skills: [
        {
          id: "alpha.review",
          name: "Alpha Review",
          description: "检查简历质量、证据和表达问题。",
        },
      ],
      agents: [
        {
          id: "alpha.primary",
          name: "Alpha Primary Agent",
          role: "primary",
          skill_ids: ["alpha.review"],
        },
      ],
      mcp_servers: [
        {
          id: "alpha.local",
          name: "Alpha Local MCP",
          transport: "stdio",
          command: "node",
          args: ["server.js"],
        },
      ],
      permissions: ["mcp.tool", "artifact.write", "memory.write"],
    });

    expect(manifest.module_format).toBe("esm");
    expect(manifest.scopes).toEqual(["context:alpha"]);
    expect(manifest.agents[0]?.role).toBe("primary");
  });

  it("rejects CommonJS plugins", () => {
    expect(() =>
      harnessPluginManifestSchema.parse({
        id: "bad.plugin",
        name: "Bad Plugin",
        version: "0.1.0",
        module_format: "commonjs",
        scopes: ["context:alpha"],
      })
    ).toThrow();
  });
});

describe("harness tool and permission schemas", () => {
  it("validates tool calls with explicit origins", () => {
    const call = harnessToolCallSchema.parse({
      id: "tool_call_1",
      name: "resource.readFile",
      origin: "resource",
      input: { path: "C:/Users/test/Documents/resume.pdf" },
    });

    expect(call.origin).toBe("resource");
  });

  it("validates permission requests and decisions", () => {
    const request = harnessPermissionRequestSchema.parse({
      id: "perm_1",
      run_id: "run_1",
      kind: "filesystem.read",
      reason: "读取用户授权的简历源文件。",
      scope: {
        uri: "file:///C:/Users/test/Documents/resume.pdf",
        access: "read",
      },
      created_at: timestamp,
    });

    const decision = harnessPermissionDecisionSchema.parse({
      id: "decision_1",
      request_id: request.id,
      status: "approved",
      remember: "context",
      created_at: timestamp,
    });

    expect(request.kind).toBe("filesystem.read");
    expect(decision.remember).toBe("context");
  });
});
