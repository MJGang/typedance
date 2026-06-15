import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createHarnessRuntime, HarnessPluginFileLoader } from "../src";

describe("HarnessPluginFileLoader", () => {
  it("loads plugin manifests and skill instruction files from disk", async () => {
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
        scopes: ["workspace:alpha"],
        skills: [
          {
            id: "alpha.review",
            name: "Alpha Review",
            description: "Review the active workspace.",
            instruction_files: ["skills/review.md"],
            tool_names: ["alpha.readWorkspace"],
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
      }),
      "utf8"
    );
    await writeFile(join(pluginDir, "skills", "review.md"), "Use evidence-first review.", "utf8");

    const loader = new HarnessPluginFileLoader(root);
    const runtime = createHarnessRuntime({
      skillContentLoader: loader.createSkillContentLoader(),
    });
    runtime.registerPlugin(await loader.loadPlugin("alpha"));

    const context = await runtime.buildAgentSkillContext({
      policy: { scopeIds: ["workspace:alpha"] },
      agentId: "alpha.primary",
    });

    expect(context.skills.map((skill) => skill.id)).toEqual(["alpha.review"]);
    expect(context.instructionsText).toContain("Use evidence-first review.");
  });

  it("rejects skill instruction path traversal", async () => {
    const root = await mkdtemp(join(tmpdir(), "harness-plugin-"));
    const pluginDir = join(root, "alpha");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      join(pluginDir, "plugin.json"),
      JSON.stringify({
        id: "alpha.agent",
        name: "Alpha Agent",
        version: "0.1.0",
        module_format: "esm",
        scopes: ["workspace:alpha"],
        skills: [
          {
            id: "alpha.review",
            name: "Alpha Review",
            description: "Review the active workspace.",
            instruction_files: ["../outside.md"],
          },
        ],
      }),
      "utf8"
    );

    const loader = new HarnessPluginFileLoader(root);
    const runtime = createHarnessRuntime({
      skillContentLoader: loader.createSkillContentLoader(),
    });
    runtime.registerPlugin(await loader.loadPlugin("alpha"));

    expect(runtime.resolveSkillsForPolicy({ scopeIds: ["workspace:alpha"] })).toHaveLength(1);
    await expect(
      runtime.buildAgentSkillContext({
        policy: { scopeIds: ["workspace:alpha"] },
        agentId: "missing",
      })
    ).rejects.toThrow();
    await expect(
      loader.createSkillContentLoader().readText({
        pluginId: "alpha.agent",
        skillId: "alpha.review",
        path: "../outside.md",
      })
    ).rejects.toThrow("Skill instruction path must stay inside plugin directory");
  });
});
