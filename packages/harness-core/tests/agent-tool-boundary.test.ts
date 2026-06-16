import { describe, expect, it } from "vitest";
import { createHarnessRuntime } from "../src";

describe("harness agent tool boundary", () => {
  it("allows only tools exposed by the agent skills or explicit agent allowlist", async () => {
    const runtime = createHarnessRuntime();
    runtime.registerPlugin({
      id: "alpha.agent",
      name: "Alpha Agent",
      version: "0.1.0",
      module_format: "esm",
      scopes: ["context:alpha"],
      skills: [
        {
          id: "alpha.review",
          name: "Alpha Review",
          description: "Review context quality.",
          tool_names: ["alpha.readContext"],
        },
      ],
      agents: [
        {
          id: "alpha.primary",
          name: "Alpha Primary Agent",
          role: "primary",
          skill_ids: ["alpha.review"],
          allowed_tool_names: ["alpha.createProposal"],
        },
      ],
    });
    runtime.registerTool({
      name: "alpha.readContext",
      origin: "mcp",
      handler: async () => ({ context_id: "context_1" }),
    });
    runtime.registerTool({
      name: "alpha.createProposal",
      origin: "mcp",
      handler: async () => ({ proposal_id: "proposal_1" }),
    });
    runtime.registerTool({
      name: "alpha.exportArtifact",
      origin: "mcp",
      handler: async () => ({ artifact_id: "artifact_1" }),
    });

    const run = runtime.createRun({
      capability_policy: { scope_ids: ["context:alpha"] },
      user_message: "Inspect this context",
    });

    const skillTool = await runtime.invokeAgentTool({
      runId: run.id,
      agentId: "alpha.primary",
      call: {
        id: "tool_call_1",
        name: "alpha.readContext",
        origin: "mcp",
        input: {},
      },
    });
    const agentAllowlistTool = await runtime.invokeAgentTool({
      runId: run.id,
      agentId: "alpha.primary",
      call: {
        id: "tool_call_2",
        name: "alpha.createProposal",
        origin: "mcp",
        input: {},
      },
    });

    expect(skillTool.status).toBe("completed");
    expect(agentAllowlistTool.status).toBe("completed");
    await expect(
      runtime.invokeAgentTool({
        runId: run.id,
        agentId: "alpha.primary",
        call: {
          id: "tool_call_3",
          name: "alpha.exportArtifact",
          origin: "mcp",
          input: {},
        },
      })
    ).rejects.toThrow("Tool alpha.exportArtifact is not allowed for agent alpha.primary by the active capability policy");
  });
});
