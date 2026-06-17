import type { HarnessAgentSkillContext } from "@typedance/harness-core";
import { describe, expect, it } from "vitest";
import {
  buildAgentHostPromptBundle,
  collectPromptFragments,
  createAgentHostPromptDebugSnapshot,
} from "../src/prompt";

describe("buildAgentHostPromptBundle", () => {
  it("formats structured plugin and skill instructions outside harness core", () => {
    const prompt = buildAgentHostPromptBundle({
      messages: [
        {
          role: "system",
          content: "Current active workspace context.",
        },
        {
          role: "user",
          content: "Review this workspace.",
        },
      ],
      skillContext: makeSkillContext(),
    });

    expect(prompt.developer.map((section) => section.source)).toEqual([
      "plugin.workspace.agent.instructions",
      "skill.workspace.review.description",
      "skill.workspace.review.instructions",
    ]);
    expect(prompt.developer[0]).toMatchObject({
      slot: "developer",
      priority: 10,
      provenance: {
        kind: "plugin_instruction",
        sourceId: "workspace.agent",
        path: "instructions.md",
      },
      budget: {
        maxChars: 4000,
        originalChars: "Plugin level guardrails.".length,
        truncated: false,
      },
    });
    expect(prompt.developer[0]?.content).toContain("Plugin level guardrails.");
    expect(prompt.developer[1]?.content).toContain("## Workspace Skill");
    expect(prompt.developer[1]?.content).toContain("Ground answers in supplied workspace context.");
    expect(prompt.developer[2]?.content).toContain("Use current workspace facts.");
    expect(JSON.stringify(prompt.developer)).not.toContain("Tools: workspace.read");
    expect(prompt.contextual).toEqual([
      expect.objectContaining({
        slot: "contextual",
        source: "message.system",
        content: "Current active workspace context.",
        priority: 100,
      }),
    ]);
    expect(prompt.conversation).toEqual([
      {
        role: "user",
        content: "Review this workspace.",
      },
    ]);
  });

  it("collects fragments with provenance and truncates by section budget", () => {
    const fragments = collectPromptFragments({
      messages: [{ role: "user", content: "Review this workspace." }],
      skillContext: {
        ...makeSkillContext(),
        pluginInstructions: [
          {
            pluginId: "workspace.agent",
            path: "instructions.md",
            content: "x".repeat(5000),
          },
        ],
      },
    });

    const pluginFragment = fragments.find((fragment) => fragment.source === "plugin.workspace.agent.instructions");
    expect(pluginFragment?.budget).toEqual({
      maxChars: 4000,
      originalChars: 5000,
      truncated: true,
    });
    expect(pluginFragment?.content).toContain("[Prompt section truncated by Agent Host budget]");
  });

  it("creates a stable prompt debug snapshot without raw conversation content", () => {
    const prompt = buildAgentHostPromptBundle({
      messages: [
        { role: "system", content: "Current active workspace context." },
        { role: "user", content: "Review this workspace." },
      ],
      skillContext: makeSkillContext(),
    });

    expect(createAgentHostPromptDebugSnapshot(prompt)).toMatchInlineSnapshot(`
      {
        "contextual": [
          {
            "budget": {
              "maxChars": 12000,
              "originalChars": 33,
              "truncated": false,
            },
            "content": "Current active workspace context.",
            "priority": 100,
            "provenance": {
              "kind": "message",
              "metadata": {
                "index": "0",
                "role": "system",
              },
            },
            "slot": "contextual",
            "source": "message.system",
          },
        ],
        "conversation": [
          {
            "contentChars": 22,
            "role": "user",
          },
        ],
        "developer": [
          {
            "budget": {
              "maxChars": 4000,
              "originalChars": 24,
              "truncated": false,
            },
            "content": "Plugin level guardrails.",
            "priority": 10,
            "provenance": {
              "kind": "plugin_instruction",
              "path": "instructions.md",
              "sourceId": "workspace.agent",
            },
            "slot": "developer",
            "source": "plugin.workspace.agent.instructions",
          },
          {
            "budget": {
              "maxChars": 1000,
              "originalChars": 65,
              "truncated": false,
            },
            "content": "## Workspace Skill

      Ground answers in supplied workspace context.",
            "priority": 20,
            "provenance": {
              "kind": "skill_description",
              "metadata": {
                "pluginId": "workspace.agent",
              },
              "sourceId": "workspace.review",
            },
            "slot": "developer",
            "source": "skill.workspace.review.description",
          },
          {
            "budget": {
              "maxChars": 4000,
              "originalChars": 28,
              "truncated": false,
            },
            "content": "Use current workspace facts.",
            "priority": 30,
            "provenance": {
              "kind": "skill_instruction",
              "metadata": {
                "pluginId": "workspace.agent",
              },
              "path": "skills/workspace.md",
              "sourceId": "workspace.review",
            },
            "slot": "developer",
            "source": "skill.workspace.review.instructions",
          },
        ],
      }
    `);
  });
});

function makeSkillContext(): HarnessAgentSkillContext {
  return {
    policy: {
      scopeIds: ["scope:workspace"],
      pluginIds: [],
    },
    agent: {
      id: "workspace.primary",
      pluginId: "workspace.agent",
      name: "Workspace Agent",
      role: "primary",
      skill_ids: ["workspace.review"],
      allowed_tool_names: [],
    },
    pluginIds: ["workspace.agent"],
    pluginInstructions: [
      {
        pluginId: "workspace.agent",
        path: "instructions.md",
        content: "Plugin level guardrails.",
      },
    ],
    skills: [
      {
        id: "workspace.review",
        pluginId: "workspace.agent",
        name: "Workspace Skill",
        description: "Ground answers in supplied workspace context.",
        instruction_files: ["skills/workspace.md"],
        tool_names: ["workspace.read"],
        instructions: [
          {
            path: "skills/workspace.md",
            content: "Use current workspace facts.",
          },
        ],
      },
    ],
    toolNames: ["workspace.read"],
  };
}
