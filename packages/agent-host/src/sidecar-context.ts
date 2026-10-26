import { workspaceViewSchema, type ContextMention, type WorkspaceView, type EditorSnapshot } from "@typedance/contracts";

export type AgentHostContextProviderInput = {
  workspaceId: string;
  mentions: ContextMention[];
  signal?: AbortSignal;
  editorSnapshot?: EditorSnapshot;
};

export type AgentHostContextItem = {
  id: string;
  kind: "workspace" | "mention" | "notice";
  content: string;
  sourceId?: string;
  path?: string;
};

export type AgentHostContextProvider = {
  loadContext(input: AgentHostContextProviderInput): Promise<AgentHostContextItem[]>;
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

  return { async loadContext(input) {
    const mentions = dedupeMentions(input.mentions);
    const selected = mentions.slice(0, maxSources);
    const workspaceTask = (async (): Promise<AgentHostContextItem[]> => {
      if (!input.workspaceId) return [];
      if (input.editorSnapshot) {
        const snapshot = input.editorSnapshot;
        if (snapshot.document_id !== input.workspaceId) throw new Error("Editor snapshot does not belong to this workspace.");
        return [{
          id: "workspace.current", kind: "workspace", sourceId: input.workspaceId,
          content: [
            "Current active resume canvas reference observed when this user message was sent:",
            `  document_id: ${snapshot.document_id}`,
            `  editor_session_id: ${snapshot.editor_session_id}`,
            `  canvas_version: ${snapshot.canvas_version}`,
            `  content_revision: ${snapshot.content_revision}`,
            `  page_count: ${snapshot.print_snapshot?.page_tops.length ?? "unavailable"}`,
            `  text_characters_at_send: ${snapshot.plain_text.length}`,
            "  tools: resume.read reads current text; resume.inspect reads current structure; resume.capabilities lists operations and fetches selected exact schemas; resume.edit executes authorized transactions; resume.view_pages returns current page images.",
            "  freshness: This reference is not document content or proof of the latest state. Tool edits and manual changes may advance the revision. Read the live editor before relying on text, paths or formatting, including after compaction or recovery. Quoted user references identify selections. Never claim to have read text or seen pages without returned evidence.",
          ].join("\n"),
        }];
      }
      let content: string;
      try {
        const response = await fetchImpl(`${baseUrl}/documents/${encodeURIComponent(input.workspaceId)}/workspace-view`, { signal: input.signal });
        content = response.ok
          ? formatWorkspaceContext(workspaceViewSchema.parse(await response.json()), maxCharactersPerSource)
            ?? formatUnavailableWorkspaceContext(input.workspaceId, "workspace has no readable source resume canvas content")
          : formatUnavailableWorkspaceContext(input.workspaceId, `sidecar returned ${response.status}`);
      } catch (error) {
        input.signal?.throwIfAborted();
        content = formatUnavailableWorkspaceContext(input.workspaceId, error instanceof Error ? error.message : "unknown error");
      }
      return [{ id: "workspace.current", kind: "workspace", sourceId: input.workspaceId, content }];
    })();
    const mentionTasks = selected.map(async (mention): Promise<AgentHostContextItem> => {
      const url = new URL(`${baseUrl}/context-sources/${encodeURIComponent(mention.context_source_id)}/content`);
      if (mention.target_path) url.searchParams.set("path", mention.target_path);
      let content: string;
      try {
        const response = await fetchImpl(url, { signal: input.signal });
        content = response.ok
          ? formatContextBlock(await response.json() as ContextSourceContentResponse, maxCharactersPerSource)
          : formatUnavailableContext(mention, response.status);
      } catch (error) {
        input.signal?.throwIfAborted();
        content = `Mentioned context unavailable: ${mention.label}. ${error instanceof Error ? error.message : "Read failed"}`;
      }
      return { id: `mention.${JSON.stringify([mention.context_source_id, mention.target_path ?? null])}`, kind: "mention", sourceId: mention.context_source_id, path: mention.target_path ?? undefined, content };
    });
    const [workspace, loadedMentions] = await Promise.all([workspaceTask, Promise.all(mentionTasks)]);
    return [...workspace, ...loadedMentions, ...(mentions.length > selected.length ? [{
      id: "context.omitted", kind: "notice" as const,
      content: `Context source limit: ${mentions.length - selected.length} mentioned sources were not loaded. Do not claim to have read them.`,
    }] : [])];
  } };
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
