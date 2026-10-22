import type {
  HarnessAgentSkillContext,
  HarnessModelMessage,
  HarnessPromptBundle,
  HarnessPromptSection,
} from "@typedance/harness-core";
import type { AgentHostContextItem } from "./sidecar-context";

export type AgentHostPromptBundleInput = {
  messages: HarnessModelMessage[];
  skillContext: HarnessAgentSkillContext;
  contributors?: AgentHostPromptContributor[];
  contextItems?: AgentHostContextItem[];
};

export type AgentHostPromptFragment = HarnessPromptSection & {
  priority: number;
  budget: NonNullable<HarnessPromptSection["budget"]>;
};

export type AgentHostPromptContributor = {
  id: string;
  collect(input: AgentHostPromptBundleInput): AgentHostPromptFragment[];
};

export type AgentHostPromptDebugSnapshot = {
  developer: AgentHostPromptDebugSection[];
  contextual: AgentHostPromptDebugSection[];
  conversation: Array<{
    role: HarnessModelMessage["role"];
    contentChars: number;
  }>;
};

export type AgentHostPromptDebugSection = {
  slot: HarnessPromptSection["slot"];
  source: string;
  priority: number;
  budget: NonNullable<HarnessPromptSection["budget"]>;
  provenance?: HarnessPromptSection["provenance"];
  content: string;
};

const PLUGIN_INSTRUCTION_BUDGET_CHARS = 4_000;
const SKILL_DESCRIPTION_BUDGET_CHARS = 1_000;
const SKILL_INSTRUCTION_BUDGET_CHARS = 4_000;
const CONTEXTUAL_MESSAGE_BUDGET_CHARS = 12_000;
const TRUNCATION_NOTICE = "\n\n[Prompt section truncated by Agent Host budget]";

const defaultPromptContributors: AgentHostPromptContributor[] = [
  {
    id: "agent_host.context_items",
    collect: ({ contextItems = [] }) => {
      const totalWeight = contextItems.reduce((sum, item) => sum + (item.kind === "workspace" ? 2 : 1), 0);
      return contextItems.map((item, index) => createPromptFragment({
        slot: "contextual",
        source: item.id,
        priority: 100 + index,
        maxChars: Math.min(12_000, Math.floor(24_000 * (item.kind === "workspace" ? 2 : 1) / totalWeight)),
        content: item.content,
        provenance: { kind: item.kind, sourceId: item.sourceId, path: item.path },
      }));
    },
  },
  {
    id: "agent_host.plugin_instructions",
    collect: ({ skillContext }) =>
      skillContext.pluginInstructions.map((instruction) =>
        createPromptFragment({
          slot: "developer",
          source: `plugin.${instruction.pluginId}.instructions`,
          priority: 10,
          maxChars: PLUGIN_INSTRUCTION_BUDGET_CHARS,
          content: instruction.content,
          provenance: {
            kind: "plugin_instruction",
            sourceId: instruction.pluginId,
            path: instruction.path,
          },
        })
      ),
  },
  {
    id: "agent_host.skill_instructions",
    collect: ({ skillContext }) =>
      skillContext.skills.flatMap((skill) => [
        createPromptFragment({
          slot: "developer",
          source: `skill.${skill.id}.description`,
          priority: 20,
          maxChars: SKILL_DESCRIPTION_BUDGET_CHARS,
          content: [`## ${skill.name}`, skill.description].filter(Boolean).join("\n\n"),
          provenance: {
            kind: "skill_description",
            sourceId: skill.id,
            metadata: {
              pluginId: skill.pluginId,
            },
          },
        }),
        ...skill.instructions.map((instruction) =>
          createPromptFragment({
            slot: "developer",
            source: `skill.${skill.id}.instructions`,
            priority: 30,
            maxChars: SKILL_INSTRUCTION_BUDGET_CHARS,
            content: instruction.content,
            provenance: {
              kind: "skill_instruction",
              sourceId: skill.id,
              path: instruction.path,
              metadata: {
                pluginId: skill.pluginId,
              },
            },
          })
        ),
      ]),
  },
  {
    id: "agent_host.system_messages",
    collect: ({ messages }) =>
      messages
        .filter((message) => message.role === "system")
        .map((message, index) =>
          createPromptFragment({
            slot: "contextual",
            source: "message.system",
            priority: 100 + index,
            maxChars: CONTEXTUAL_MESSAGE_BUDGET_CHARS,
            content: message.content,
            provenance: {
              kind: "message",
              metadata: {
                role: message.role,
                index: String(index),
              },
            },
          })
        ),
  },
];

export function buildAgentHostPromptBundle(input: AgentHostPromptBundleInput): HarnessPromptBundle {
  const sections = collectPromptFragments(input);
  return {
    developer: sections.filter((section) => section.slot === "developer"),
    contextual: sections.filter((section) => section.slot === "contextual"),
    conversation: input.messages.filter((message) => message.role !== "system"),
  };
}

export function collectPromptFragments(input: AgentHostPromptBundleInput): AgentHostPromptFragment[] {
  const contributors = input.contributors ?? defaultPromptContributors;
  return contributors
    .flatMap((contributor) => contributor.collect(input))
    .map(normalizePromptFragment)
    .filter((section) => section.content.length > 0)
    .sort((left, right) => left.priority - right.priority);
}

export function createAgentHostPromptDebugSnapshot(prompt: HarnessPromptBundle): AgentHostPromptDebugSnapshot {
  return {
    developer: prompt.developer.map(toDebugSection),
    contextual: prompt.contextual.map(toDebugSection),
    conversation: prompt.conversation.map((message) => ({
      role: message.role,
      contentChars: typeof message.content === "string" ? message.content.length : message.content.reduce((sum, part) => sum + (part.type === "text" ? part.text.length : 0), 0),
    })),
  };
}

export function renderAgentHostPromptSections(sections: HarnessPromptSection[]): string {
  return sections
    .map((section) => [`# ${section.source}`, section.content.trim()].join("\n\n"))
    .join("\n\n");
}

function createPromptFragment(input: {
  slot: HarnessPromptSection["slot"];
  source: string;
  priority: number;
  maxChars: number;
  content: string;
  provenance?: HarnessPromptSection["provenance"];
}): AgentHostPromptFragment {
  const content = input.content.trim();
  const originalChars = content.length;
  const truncatedContent = truncateToBudget(content, input.maxChars);
  return {
    slot: input.slot,
    source: input.source,
    content: truncatedContent,
    priority: input.priority,
    budget: {
      maxChars: input.maxChars,
      originalChars,
      truncated: originalChars > input.maxChars,
    },
    provenance: input.provenance,
  };
}

function normalizePromptFragment(fragment: AgentHostPromptFragment): AgentHostPromptFragment {
  return {
    ...fragment,
    content: fragment.content.trim(),
  };
}

function truncateToBudget(content: string, maxChars: number): string {
  if (content.length <= maxChars) {
    return content;
  }
  const available = Math.max(0, maxChars - TRUNCATION_NOTICE.length);
  return `${content.slice(0, available).trimEnd()}${TRUNCATION_NOTICE}`;
}

function toDebugSection(section: HarnessPromptSection): AgentHostPromptDebugSection {
  return {
    slot: section.slot,
    source: section.source,
    priority: section.priority ?? 0,
    budget: section.budget ?? {
      maxChars: section.content.length,
      originalChars: section.content.length,
      truncated: false,
    },
    provenance: section.provenance,
    content: section.content,
  };
}
