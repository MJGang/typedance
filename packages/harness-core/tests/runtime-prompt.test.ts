import { describe, expect, it } from "vitest";
import type { HarnessModelRequest } from "../src/model/model-adapter";
import { HarnessRuntime } from "../src/runtime";

describe("HarnessRuntime prompt assembly", () => {
  it("does not assemble prompt policy from skills or runtime context", async () => {
    let captured: HarnessModelRequest | undefined;
    const runtime = new HarnessRuntime({
      skillContentLoader: {
        readText: ({ path }) => `Loaded instruction file: ${path}`,
      },
      model: {
        async *stream(request) {
          captured = request;
          yield {
            type: "final",
            output: { ok: true },
          };
        },
      },
    });
    runtime.registerPlugin({
      id: "example.agent",
      name: "Example Agent",
      version: "0.1.0",
      module_format: "esm",
      scopes: ["scope:example"],
      instructions: ["instructions.md"],
      skills: [
        {
          id: "example.context",
          name: "Example Context",
          description: "Ground answers in supplied context.",
          instruction_files: ["skills/context.md"],
          tool_names: ["example.context.read"],
        },
      ],
      agents: [
        {
          id: "example.primary",
          name: "Example Primary",
          role: "primary",
          skill_ids: ["example.context"],
          allowed_tool_names: [],
        },
      ],
      mcp_servers: [],
      permissions: [],
    });
    const run = runtime.createRun({
      capability_policy: {
        scope_ids: ["scope:example"],
        plugin_ids: [],
      },
      user_message: "Review this project.",
      context: {
        secret_business_context: "must stay structured unless the host explicitly prompts with it",
      },
    });

    await runtime.runAgentTurn({
      runId: run.id,
      agentId: "example.primary",
      messages: [{ role: "user", content: "Review this project." }],
    });

    expect("skillContext" in (captured ?? {})).toBe(false);
    expect("messages" in (captured ?? {})).toBe(false);
    expect(captured?.prompt).toEqual({
      developer: [],
      contextual: [],
      conversation: [{ role: "user", content: "Review this project." }],
    });
    const requestJson = JSON.stringify(captured);
    expect(requestJson).not.toContain("Loaded instruction file");
    expect(requestJson).not.toContain("secret_business_context");
  });

  it("passes a host-owned prompt bundle through unchanged", async () => {
    let captured: HarnessModelRequest | undefined;
    const runtime = new HarnessRuntime({
      model: {
        async *stream(request) {
          captured = request;
          yield {
            type: "final",
            output: { ok: true },
          };
        },
      },
    });
    runtime.registerPlugin({
      id: "example.agent",
      name: "Example Agent",
      version: "0.1.0",
      module_format: "esm",
      scopes: ["scope:example"],
      skills: [],
      agents: [
        {
          id: "example.primary",
          name: "Example Primary",
          role: "primary",
          skill_ids: [],
          allowed_tool_names: [],
        },
      ],
      mcp_servers: [],
      permissions: [],
    });
    const run = runtime.createRun({
      capability_policy: {
        scope_ids: ["scope:example"],
        plugin_ids: [],
      },
      user_message: "Review this project.",
      context: {},
    });
    const prompt = {
      developer: [
        {
          slot: "developer" as const,
          source: "agent_host.instructions",
          content: "Host-owned instruction text.",
        },
      ],
      contextual: [
        {
          slot: "contextual" as const,
          source: "agent_host.context",
          content: "Host-owned context text.",
        },
      ],
      conversation: [{ role: "user" as const, content: "Review this project." }],
    };

    await runtime.runAgentTurn({
      runId: run.id,
      agentId: "example.primary",
      messages: [{ role: "user", content: "Review this project." }],
      prompt,
    });

    expect(captured?.prompt).toBe(prompt);
    expect("messages" in (captured ?? {})).toBe(false);
  });
});
