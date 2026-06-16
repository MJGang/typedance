import { workspaceViewSchema, type ContextMention, type WorkspaceView } from "@typedance/contracts";

export type AgentHostContextProviderInput = {
  workspaceId: string;
  mentions: ContextMention[];
};

export type AgentHostContextProvider = {
  loadWorkspaceContext?(input: AgentHostContextProviderInput): Promise<string | undefined>;
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

type ResumeDocNode = {
  type?: unknown;
  text?: unknown;
  content?: unknown;
};

const DEFAULT_SIDECAR_BASE_URL = "http://127.0.0.1:4317";

export function createSidecarContextProvider(options: SidecarContextProviderOptions = {}): AgentHostContextProvider {
  const baseUrl = (options.baseUrl ?? DEFAULT_SIDECAR_BASE_URL).replace(/\/+$/, "");
  const fetchImpl = options.fetch ?? fetch;
  const maxSources = options.maxSources ?? 6;
  const maxCharactersPerSource = options.maxCharactersPerSource ?? 16000;

  return {
    async loadWorkspaceContext(input) {
      if (!input.workspaceId) return undefined;

      try {
        const response = await fetchImpl(`${baseUrl}/documents/${encodeURIComponent(input.workspaceId)}/workspace-view`);
        if (!response.ok) {
          return formatUnavailableWorkspaceContext(input.workspaceId, `sidecar returned ${response.status}`);
        }

        const workspace = workspaceViewSchema.parse(await response.json());
        return formatWorkspaceContext(workspace, maxCharactersPerSource)
          ?? formatUnavailableWorkspaceContext(input.workspaceId, "workspace has no readable source resume canvas content");
      } catch (error) {
        const reason = error instanceof Error ? error.message : "unknown error";
        return formatUnavailableWorkspaceContext(input.workspaceId, reason);
      }
    },

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

function formatWorkspaceContext(workspace: WorkspaceView, maxCharacters: number): string | undefined {
  const canvas = workspace.source_resume_canvas;
  if (!canvas) return undefined;

  const nodeMapText = canvas.node_map
    .map((node) => node.text.trim())
    .filter(Boolean)
    .join("\n");
  const canvasText = nodeMapText || collectDocText(canvas.doc_json);
  if (!canvasText.trim()) return undefined;

  const text = canvasText.length > maxCharacters
    ? `${canvasText.slice(0, maxCharacters)}\n[truncated by Agent Host]`
    : canvasText;

  return [
    "Current active resume canvas:",
    `  document_id: ${workspace.document.id}`,
    `  title: ${workspace.document.title}`,
    "  priority: This is the primary source of truth for the resume being discussed. Do not replace it with older conversation history or mentioned webpages unless the user explicitly asks.",
    "  content:",
    indent(text),
  ].join("\n");
}

function formatUnavailableWorkspaceContext(workspaceId: string, reason: string): string {
  return [
    "Current active resume canvas: unavailable",
    `  document_id: ${workspaceId}`,
    `  reason: ${reason}`,
    "  instruction: Do not summarize, score, or rewrite the current document unless current canvas content is supplied. Tell the user the current document could not be read and ask them to retry after the workspace finishes loading or saving.",
  ].join("\n");
}

function collectDocText(value: unknown): string {
  if (!isRecord(value)) return "";
  const node = value as ResumeDocNode;
  if (typeof node.text === "string") return node.text;
  if (!Array.isArray(node.content)) return "";

  const separator = node.type === "paragraph" ? "" : "\n";
  return node.content
    .map(collectDocText)
    .filter(Boolean)
    .join(separator);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
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
