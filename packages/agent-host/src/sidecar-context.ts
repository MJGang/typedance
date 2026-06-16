import type { ContextMention } from "@typedance/contracts";

export type AgentHostContextProviderInput = {
  workspaceId: string;
  mentions: ContextMention[];
};

export type AgentHostContextProvider = {
  loadMentionedContext(input: AgentHostContextProviderInput): Promise<string | undefined>;
};

export type SidecarContextProviderOptions = {
  baseUrl?: string;
  fetch?: typeof fetch;
  maxSources?: number;
  maxCharactersPerSource?: number;
};

type ContextSourceContentResponse = {
  source_id: string;
  type: string;
  title: string;
  uri: string;
  path?: string | null;
  text: string;
  truncated: boolean;
};

const DEFAULT_SIDECAR_BASE_URL = "http://127.0.0.1:4317";

export function createSidecarContextProvider(options: SidecarContextProviderOptions = {}): AgentHostContextProvider {
  const baseUrl = (options.baseUrl ?? DEFAULT_SIDECAR_BASE_URL).replace(/\/+$/, "");
  const fetchImpl = options.fetch ?? fetch;
  const maxSources = options.maxSources ?? 6;
  const maxCharactersPerSource = options.maxCharactersPerSource ?? 16000;

  return {
    async loadMentionedContext(input) {
      const uniqueMentions = dedupeMentions(input.mentions).slice(0, maxSources);
      if (uniqueMentions.length === 0) return undefined;

      const blocks: string[] = [];
      for (const mention of uniqueMentions) {
        const url = new URL(`${baseUrl}/context-sources/${encodeURIComponent(mention.context_source_id)}/content`);
        if (mention.target_path) url.searchParams.set("path", mention.target_path);
        const response = await fetchImpl(url);
        if (!response.ok) {
          blocks.push(formatUnavailableContext(mention, response.status));
          continue;
        }

        const content = await response.json() as ContextSourceContentResponse;
        blocks.push(formatContextBlock(content, maxCharactersPerSource));
      }

      return [
        "User-mentioned read-only context sources:",
        ...blocks,
      ].join("\n\n");
    },
  };
}

function dedupeMentions(mentions: ContextMention[]): ContextMention[] {
  const seen = new Set<string>();
  return mentions.filter((mention) => {
    const key = `${mention.context_source_id}:${mention.target_path ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatContextBlock(content: ContextSourceContentResponse, maxCharacters: number): string {
  const text = content.text.length > maxCharacters
    ? `${content.text.slice(0, maxCharacters)}\n[truncated by Agent Host]`
    : content.text;
  return [
    `- ${content.title}`,
    `  id: ${content.source_id}`,
    `  type: ${content.type}`,
    `  uri: ${content.uri}`,
    content.path ? `  path: ${content.path}` : undefined,
    `  truncated: ${content.truncated || content.text.length > maxCharacters}`,
    "  content:",
    indent(text),
  ].filter(Boolean).join("\n");
}

function formatUnavailableContext(mention: ContextMention, status: number): string {
  return [
    `- ${mention.label}`,
    `  id: ${mention.context_source_id}`,
    `  type: ${mention.type}`,
    mention.uri ? `  uri: ${mention.uri}` : undefined,
    `  error: failed to read context source (${status})`,
  ].filter(Boolean).join("\n");
}

function indent(text: string): string {
  return text.split(/\r?\n/).map((line) => `    ${line}`).join("\n");
}
