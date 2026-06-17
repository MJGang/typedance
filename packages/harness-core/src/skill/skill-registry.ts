import type {
  HarnessAgentDefinition,
  HarnessPluginManifest,
  HarnessSkillDefinition,
} from "@typedance/harness-contracts";
import type { HarnessResolvedCapabilityPolicy } from "../plugin/plugin-registry";

export type HarnessSkillContentLoaderInput = {
  pluginId: string;
  skillId: string;
  path: string;
};

export type HarnessSkillContentLoader = {
  readText(input: HarnessSkillContentLoaderInput): Promise<string> | string;
};

export type HarnessResolvedSkill = HarnessSkillDefinition & {
  pluginId: string;
  instructions: Array<{
    path: string;
    content: string;
  }>;
};

export type HarnessResolvedAgent = HarnessAgentDefinition & {
  pluginId: string;
};

export type HarnessAgentSkillContext = {
  policy: HarnessResolvedCapabilityPolicy;
  agent: HarnessResolvedAgent;
  pluginIds: string[];
  pluginInstructions: Array<{
    pluginId: string;
    path: string;
    content: string;
  }>;
  skills: HarnessResolvedSkill[];
  toolNames: string[];
};

export type HarnessBuildAgentSkillContextInput = {
  policy: HarnessResolvedCapabilityPolicy;
  agentId: string;
  plugins: HarnessPluginManifest[];
};

const emptySkillContentLoader: HarnessSkillContentLoader = {
  readText: () => "",
};

export class HarnessSkillRegistry {
  #loader: HarnessSkillContentLoader;

  constructor(loader: HarnessSkillContentLoader = emptySkillContentLoader) {
    this.#loader = loader;
  }

  resolveSkillsForPlugins(plugins: HarnessPluginManifest[]): HarnessResolvedSkill[] {
    return plugins.flatMap((plugin) =>
      plugin.skills.map((skill) => ({
        ...skill,
        pluginId: plugin.id,
        instructions: [],
      }))
    );
  }

  async buildAgentContext(input: HarnessBuildAgentSkillContextInput): Promise<HarnessAgentSkillContext> {
    const agent = this.#findAgent(input.agentId, input.plugins);
    const availableSkills = this.resolveSkillsForPlugins(input.plugins);
    const selectedSkills = agent.skill_ids.map((skillId) => {
      const skill = availableSkills.find((candidate) => candidate.id === skillId);
      if (!skill) {
        throw new Error(`Agent ${agent.id} references missing skill ${skillId}`);
      }
      return skill;
    });

    const skillsWithInstructions = await Promise.all(
      selectedSkills.map(async (skill) => ({
        ...skill,
        instructions: await Promise.all(
          skill.instruction_files.map(async (path) => ({
            path,
            content: await this.#loader.readText({
              pluginId: skill.pluginId,
              skillId: skill.id,
              path,
            }),
          }))
        ),
      }))
    );

    const pluginInstructions = await this.#loadPluginInstructions(input.plugins);

    return {
      policy: input.policy,
      agent,
      pluginIds: [...new Set(skillsWithInstructions.map((skill) => skill.pluginId))],
      pluginInstructions,
      skills: skillsWithInstructions,
      toolNames: this.#collectToolNames(skillsWithInstructions),
    };
  }

  #findAgent(agentId: string, plugins: HarnessPluginManifest[]): HarnessResolvedAgent {
    for (const plugin of plugins) {
      const agent = plugin.agents.find((candidate) => candidate.id === agentId);
      if (agent) {
        return {
          ...agent,
          pluginId: plugin.id,
        };
      }
    }

    throw new Error(`Unknown harness agent: ${agentId}`);
  }

  #collectToolNames(skills: HarnessResolvedSkill[]): string[] {
    return [...new Set(skills.flatMap((skill) => skill.tool_names))];
  }

  async #loadPluginInstructions(
    plugins: HarnessPluginManifest[]
  ): Promise<Array<{ pluginId: string; path: string; content: string }>> {
    const instructions = await Promise.all(
      plugins.flatMap((plugin) =>
        plugin.instructions.map(async (path) => ({
          pluginId: plugin.id,
          path,
          content: await this.#loader.readText({
            pluginId: plugin.id,
            skillId: "__plugin__",
            path,
          }),
        }))
      )
    );
    return instructions;
  }
}
