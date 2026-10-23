import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHarnessRuntime } from "@typedance/harness-core";
import { describe, expect, it } from "vitest";
import { buildAgentHostPromptBundle } from "../src/prompt";
import {
  createResumePluginLoader,
  registerResumeWorkbenchPlugin,
  RESUME_PRIMARY_AGENT_ID,
} from "../src/resume-plugin";

describe("resume plugin registration", () => {
  it("resolves the bundled resume plugin without depending on process cwd", async () => {
    const originalCwd = process.cwd();
    const outsideWorkspace = await mkdtemp(join(tmpdir(), "typedance-agent-host-"));
    try {
      process.chdir(outsideWorkspace);
      const loader = createResumePluginLoader();
      const runtime = createHarnessRuntime({
        skillContentLoader: loader.createSkillContentLoader(),
      });

      await registerResumeWorkbenchPlugin(runtime, loader);

      expect(runtime.resolvePluginsForPolicy({ scopeIds: ["pack:resume"] }).map((plugin) => plugin.id)).toEqual([
        "resume.agent",
      ]);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("declares the host-provided text preview tool and keeps sidecar business tools out of the runtime core", async () => {
    const loader = createResumePluginLoader(process.cwd());
    const runtime = createHarnessRuntime({
      skillContentLoader: loader.createSkillContentLoader(),
    });

    await registerResumeWorkbenchPlugin(runtime, loader);

    const plugins = runtime.resolvePluginsForPolicy({ scopeIds: ["pack:resume"] });
    expect(plugins.map((plugin) => plugin.id)).toEqual(["resume.agent"]);
    expect(plugins[0]?.skills.flatMap((skill) => skill.tool_names)).toEqual(["resume.read", "resume.inspect", "resume.view_pages", "resume.capabilities", "resume.edit"]);
    expect(plugins[0]?.mcp_servers).toEqual([]);
    expect(plugins[0]?.permissions).toEqual([]);

    const skillContext = await runtime.buildAgentSkillContext({
      policy: {
        scopeIds: ["pack:resume"],
        pluginIds: [],
      },
      agentId: RESUME_PRIMARY_AGENT_ID,
    });
    const prompt = buildAgentHostPromptBundle({
      messages: [{ role: "user", content: "Review this resume." }],
      skillContext,
    });

    expect(prompt.developer.map((section) => section.source)).toEqual([
      "plugin.resume.agent.instructions",
      "skill.resume.workspace.description",
      "skill.resume.review.description",
      "skill.resume.revision.description",
      "skill.resume.workspace.instructions",
      "skill.resume.review.instructions",
      "skill.resume.revision.instructions",
    ]);
    const developerContent = prompt.developer.map((section) => section.content).join("\n\n");
    expect(developerContent).toContain("# Resume Agent");
    expect(developerContent).toContain("# Resume Workspace Skill");
    expect(developerContent).toContain("# Resume Review Skill");
    expect(developerContent).toContain("# 简历编辑");
    expect(developerContent).toContain("current workspace/canvas content is not supplied");
    expect(developerContent).not.toContain("Use MCP tools");
    expect(developerContent).not.toContain("Python MCP tools");
    expect(developerContent).toContain("`resume.capabilities`");
    expect(developerContent).toContain("`resume.edit`");
    expect(developerContent).not.toContain("resume.get");
  });
});
