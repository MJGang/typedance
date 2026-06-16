import { describe, expect, it } from "vitest";
import { createHarnessRuntime } from "../src";

describe("harness skill runtime", () => {
  it("builds agent skill context from policy-matched plugins", async () => {
    const runtime = createHarnessRuntime({
      skillContentLoader: {
        readText: async ({ path, pluginId }) => `${pluginId}:${path}: instructions`,
      },
    });

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
          instruction_files: ["skills/review.md"],
          tool_names: ["alpha.readContext", "alpha.createProposal"],
        },
        {
          id: "alpha.export",
          name: "Alpha Export",
          description: "Export a context artifact.",
          instruction_files: ["skills/export.md"],
          tool_names: ["alpha.exportArtifact"],
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
    });
    runtime.registerPlugin({
      id: "beta.agent",
      name: "Beta Agent",
      version: "0.1.0",
      module_format: "esm",
      scopes: ["context:beta"],
      skills: [
        {
          id: "beta.outline",
          name: "Beta Outline",
          description: "Create an outline.",
          instruction_files: ["skills/outline.md"],
          tool_names: ["beta.createOutline"],
        },
      ],
      agents: [
        {
          id: "beta.primary",
          name: "Beta Primary Agent",
          role: "primary",
          skill_ids: ["beta.outline"],
        },
      ],
    });

    const context = await runtime.buildAgentSkillContext({
      policy: { scopeIds: ["context:alpha"] },
      agentId: "alpha.primary",
    });

    expect(context.agent.id).toBe("alpha.primary");
    expect(context.skills.map((skill) => skill.id)).toEqual(["alpha.review"]);
    expect(context.toolNames).toEqual(["alpha.readContext", "alpha.createProposal"]);
    expect(context.instructionsText).toContain("## Alpha Review");
    expect(context.instructionsText).toContain("alpha.agent:skills/review.md: instructions");
    expect(context.instructionsText).not.toContain("alpha.exportArtifact");
    expect(context.instructionsText).not.toContain("beta.createOutline");
  });

  it("can resolve all skills available to a capability policy", () => {
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
        },
      ],
    });
    runtime.registerPlugin({
      id: "beta.agent",
      name: "Beta Agent",
      version: "0.1.0",
      module_format: "esm",
      scopes: ["context:beta"],
      skills: [
        {
          id: "beta.plot",
          name: "Beta Plot",
          description: "Plan a structured artifact.",
        },
      ],
    });

    expect(runtime.resolveSkillsForPolicy({ scopeIds: ["context:alpha"] }).map((skill) => skill.id)).toEqual([
      "alpha.review",
    ]);
  });

  it("rejects an agent that references a missing skill", async () => {
    const runtime = createHarnessRuntime();
    runtime.registerPlugin({
      id: "alpha.agent",
      name: "Alpha Agent",
      version: "0.1.0",
      module_format: "esm",
      scopes: ["context:alpha"],
      agents: [
        {
          id: "alpha.primary",
          name: "Alpha Primary Agent",
          role: "primary",
          skill_ids: ["alpha.missing"],
        },
      ],
    });

    await expect(
      runtime.buildAgentSkillContext({
        policy: { scopeIds: ["context:alpha"] },
        agentId: "alpha.primary",
      })
    ).rejects.toThrow("Agent alpha.primary references missing skill alpha.missing");
  });
});
