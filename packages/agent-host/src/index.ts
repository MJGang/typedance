import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { HarnessRun, HarnessRunEvent } from "@typedance/harness-contracts";
import type { HarnessRuntime } from "@typedance/harness-core";
import {
  canvasMutationModeSchema,
  contextMentionSchema,
  type AgentConversation,
  type AgentMessage,
  type AgentPluginSummary,
  type AgentRun,
  type AgentRunEvent,
  type CanvasMutationMode,
  type ContextMention,
} from "@typedance/contracts";
import {
  createMemoryAgentHostStore,
  type AgentHostStore,
} from "./store";
export {
  JsonFileAgentHostStore,
  MemoryAgentHostStore,
  createJsonFileAgentHostStore,
  createMemoryAgentHostStore,
  type AgentHostStore,
  type AgentHostStoreSnapshot,
} from "./store";

export type AgentHostCapabilityPolicy = {
  scopeIds?: string[];
  pluginIds?: string[];
};

export type AgentHostPackDefinition = {
  id: string;
  capabilityPolicy: AgentHostCapabilityPolicy;
  primaryAgentId: string;
  defaultContext?: Record<string, unknown>;
};

export type AgentHostStartConversationRunInput = {
  packId?: string;
  message: {
    content: string;
    mentions?: ContextMention[];
  };
  model?: string;
  mutationMode?: CanvasMutationMode;
  context?: Record<string, unknown>;
};

export type AgentHostOptions = {
  runtime: HarnessRuntime;
  packs: AgentHostPackDefinition[];
  store?: AgentHostStore;
  now?: () => Date;
};

export class AgentHost {
  readonly runtime: HarnessRuntime;
  readonly store: AgentHostStore;
  #packs = new Map<string, AgentHostPackDefinition>();
  #runTasks = new Map<string, Promise<Record<string, unknown>>>();
  #subscribers = new Map<string, Set<(event: AgentRunEvent) => void>>();
  #now: () => Date;

  constructor(options: AgentHostOptions) {
    this.runtime = options.runtime;
    this.store = options.store ?? createMemoryAgentHostStore();
    this.#now = options.now ?? (() => new Date());
    for (const pack of options.packs) {
      if (this.#packs.has(pack.id)) {
        throw new Error(`Duplicate agent host pack: ${pack.id}`);
      }
      this.#packs.set(pack.id, pack);
    }
  }

  listPacks(): AgentHostPackDefinition[] {
    return [...this.#packs.values()];
  }

  getPack(packId: string): AgentHostPackDefinition {
    const pack = this.#packs.get(packId);
    if (!pack) {
      throw new Error(`Unknown agent host pack: ${packId}`);
    }
    return pack;
  }

  listPluginsForWorkspace(workspaceId: string, packId = "resume"): AgentPluginSummary[] {
    void workspaceId;
    const pack = this.getPack(packId);
    return this.runtime.resolvePluginsForPolicy({
      scopeIds: pack.capabilityPolicy.scopeIds ?? [],
      pluginIds: pack.capabilityPolicy.pluginIds ?? [],
    }).map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      description: plugin.description,
      enabled: true,
    }));
  }

  listConversations(workspaceId: string): AgentConversation[] {
    return this.store.listConversations(workspaceId);
  }

  createConversation(workspaceId: string, title?: string): AgentConversation {
    return this.store.createConversation({
      workspaceId,
      title,
      timestamp: this.#timestamp(),
    });
  }

  updateConversation(
    conversationId: string,
    patch: Partial<Pick<AgentConversation, "title" | "pinned">>
  ): AgentConversation {
    const cleanedPatch: Partial<Pick<AgentConversation, "title" | "pinned">> = {};
    if (patch.title !== undefined) cleanedPatch.title = patch.title;
    if (patch.pinned !== undefined) cleanedPatch.pinned = patch.pinned;
    return this.store.updateConversation(conversationId, {
      ...cleanedPatch,
      updated_at: this.#timestamp(),
    });
  }

  deleteConversation(conversationId: string): boolean {
    return this.store.deleteConversation(conversationId);
  }

  listMessages(conversationId: string): AgentMessage[] {
    return this.store.listMessages(conversationId);
  }

  getAgentRun(runId: string): AgentRun {
    const run = this.store.getRun(runId);
    if (!run) {
      throw new Error(`Unknown agent run: ${runId}`);
    }
    return run;
  }

  listAgentRunEvents(runId: string, afterSequence = -1): AgentRunEvent[] {
    return this.store.listRunEvents(runId, afterSequence);
  }

  startConversationRun(
    workspaceId: string,
    conversationId: string,
    input: AgentHostStartConversationRunInput
  ): AgentRun {
    const pack = this.getPack(input.packId ?? "resume");
    const conversation = this.store.getConversation(conversationId);
    if (!conversation || conversation.workspace_id !== workspaceId) {
      throw new Error(`Unknown conversation for workspace: ${conversationId}`);
    }

    const content = input.message.content.trim();
    if (!content) {
      throw new Error("message.content must be non-empty");
    }

    const timestamp = this.#timestamp();
    const mentions = (input.message.mentions ?? []).map((mention) => contextMentionSchema.parse(mention));
    const userMessage = this.store.appendMessage({
      message: {
        id: this.#messageId(),
        conversation_id: conversationId,
        role: "user",
        content,
        mentions,
        created_at: timestamp,
      },
    });
    const assistantMessage = this.store.appendMessage({
      message: {
        id: this.#messageId(),
        conversation_id: conversationId,
        role: "assistant",
        content: "",
        mentions: [],
        created_at: timestamp,
      },
    });
    const mutationMode = canvasMutationModeSchema.parse(input.mutationMode ?? "review");
    const context = {
      ...pack.defaultContext,
      ...input.context,
      pack_id: pack.id,
      workspace_id: workspaceId,
      conversation_id: conversationId,
      user_message_id: userMessage.id,
      assistant_message_id: assistantMessage.id,
      mutation_mode: mutationMode,
      mentions,
      ...(input.model ? { model: input.model } : {}),
    };
    const harnessRun = this.runtime.createRun({
      capability_policy: {
        scope_ids: [...new Set(pack.capabilityPolicy.scopeIds ?? [])],
        plugin_ids: [...new Set(pack.capabilityPolicy.pluginIds ?? [])],
      },
      user_message: content,
      context,
    });
    const agentRun = this.store.createRun({
      run: {
        id: harnessRun.id,
        conversation_id: conversationId,
        assistant_message_id: assistantMessage.id,
        status: "running",
        model: input.model,
        mutation_mode: mutationMode,
        started_at: timestamp,
      },
    });
    this.store.updateMessage(assistantMessage.id, { run_id: agentRun.id });
    this.store.updateConversation(conversationId, {
      status: "running",
      last_message_at: timestamp,
      updated_at: timestamp,
    });

    const projector = this.#projectHarnessEvents(agentRun.id, assistantMessage.id, conversationId);
    const task = this.#startAgentTurn(pack, harnessRun, content, context);
    const combinedTask = task.finally(async () => {
      await projector;
    });
    this.#runTasks.set(agentRun.id, combinedTask);
    void combinedTask.finally(() => {
      this.#runTasks.delete(agentRun.id);
    });
    return agentRun;
  }

  async waitForRun(runId: string): Promise<Record<string, unknown> | undefined> {
    return this.#runTasks.get(runId);
  }

  streamAgentRunEvents(runId: string, options: { afterSequence?: number } = {}): AsyncIterableIterator<AgentRunEvent> {
    const pending = this.store.listRunEvents(runId, options.afterSequence ?? -1);
    const waiting: Array<(value: IteratorResult<AgentRunEvent>) => void> = [];
    let closed = false;

    const subscriber = (event: AgentRunEvent) => {
      if (event.sequence <= (options.afterSequence ?? -1)) return;
      const waiter = waiting.shift();
      if (waiter) {
        waiter({ done: false, value: event });
        return;
      }
      pending.push(event);
    };

    const subscribers = this.#subscribers.get(runId) ?? new Set<(event: AgentRunEvent) => void>();
    subscribers.add(subscriber);
    this.#subscribers.set(runId, subscribers);

    const close = () => {
      closed = true;
      subscribers.delete(subscriber);
      while (waiting.length > 0) {
        waiting.shift()?.({ done: true, value: undefined });
      }
    };

    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      next() {
        if (pending.length > 0) {
          return Promise.resolve({ done: false, value: pending.shift() as AgentRunEvent });
        }
        if (closed) {
          return Promise.resolve({ done: true, value: undefined });
        }
        return new Promise<IteratorResult<AgentRunEvent>>((resolve) => {
          waiting.push(resolve);
        });
      },
      return() {
        close();
        return Promise.resolve({ done: true, value: undefined });
      },
      throw(error?: unknown) {
        close();
        return Promise.reject(error);
      },
    };
  }

  async #startAgentTurn(
    pack: AgentHostPackDefinition,
    run: HarnessRun,
    userMessage: string,
    context: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    try {
      return await this.runtime.runAgentTurn({
        runId: run.id,
        agentId: pack.primaryAgentId,
        messages: [{ role: "user", content: userMessage }],
        context,
      });
    } catch (error) {
      this.runtime.failRun(run.id, {
        code: "agent_turn_failed",
        message: error instanceof Error ? error.message : "Agent turn failed",
      });
      throw error;
    }
  }

  async #projectHarnessEvents(runId: string, assistantMessageId: string, conversationId: string): Promise<void> {
    const stream = this.runtime.streamEvents(runId, { afterSequence: -1 });
    for await (const event of stream) {
      this.#recordProjectedEvent(runId, assistantMessageId, conversationId, event);
      if (event.type === "run.completed" || event.type === "run.failed" || event.type === "run.canceled") {
        await stream.return?.();
        return;
      }
    }
  }

  #recordProjectedEvent(
    runId: string,
    assistantMessageId: string,
    conversationId: string,
    event: HarnessRunEvent
  ): void {
    const timestamp = event.created_at;
    if (event.type === "reasoning.summary.delta") {
      this.#appendAgentRunEvent(runId, "thinking_delta", { delta: event.delta, summary_id: event.summary_id }, timestamp);
      return;
    }
    if (event.type === "assistant.delta") {
      const existing = this.store.getMessage(assistantMessageId);
      if (existing) {
        this.store.updateMessage(assistantMessageId, { content: `${existing.content}${event.delta}` });
      }
      this.#appendAgentRunEvent(runId, "assistant_delta", { delta: event.delta, message_id: event.message_id }, timestamp);
      return;
    }
    if (event.type === "tool.call.started") {
      this.#appendAgentRunEvent(runId, "tool_call_started", { tool_call: event.tool_call }, timestamp);
      return;
    }
    if (event.type === "tool.call.delta") {
      this.#appendAgentRunEvent(runId, "tool_call_delta", { tool_call_id: event.tool_call_id, delta: event.delta }, timestamp);
      return;
    }
    if (event.type === "tool.call.completed") {
      this.#appendAgentRunEvent(runId, "tool_call_completed", { result: event.result }, timestamp);
      return;
    }
    if (event.type === "artifact.patch.proposed") {
      this.#appendAgentRunEvent(runId, "canvas_patch_proposed", {
        artifact_id: event.artifact_id,
        patch_id: event.patch_id,
        summary: event.summary,
        diff: event.diff,
      }, timestamp);
      return;
    }
    if (event.type === "artifact.patch.applied") {
      this.#appendAgentRunEvent(runId, "canvas_patch_applied", {
        artifact_id: event.artifact_id,
        patch_id: event.patch_id,
      }, timestamp);
      return;
    }
    if (event.type === "run.completed") {
      this.#completeProjectedRun(runId, conversationId, "completed", timestamp);
      this.#appendAgentRunEvent(runId, "run_completed", { output: event.output }, timestamp);
      this.#maybeGenerateConversationTitle(conversationId, timestamp);
      return;
    }
    if (event.type === "run.failed") {
      this.#completeProjectedRun(runId, conversationId, "failed", timestamp);
      this.#appendAgentRunEvent(runId, "run_failed", { error: event.error }, timestamp);
      return;
    }
    if (event.type === "run.canceled") {
      this.#completeProjectedRun(runId, conversationId, "cancelled", timestamp);
      this.#appendAgentRunEvent(runId, "run_cancelled", { reason: event.reason }, timestamp);
      return;
    }

    this.#appendAgentRunEvent(runId, "harness_event", { event }, timestamp);
  }

  #completeProjectedRun(
    runId: string,
    conversationId: string,
    status: "completed" | "failed" | "cancelled",
    timestamp: string
  ): void {
    const run = this.store.getRun(runId);
    const durationMs = run ? Math.max(0, Date.parse(timestamp) - Date.parse(run.started_at)) : undefined;
    this.store.updateRun(runId, {
      status,
      completed_at: timestamp,
      duration_ms: Number.isFinite(durationMs) ? durationMs : undefined,
    });
    this.store.updateConversation(conversationId, {
      status: status === "failed" ? "failed" : "idle",
      last_message_at: timestamp,
      updated_at: timestamp,
    });
  }

  #maybeGenerateConversationTitle(conversationId: string, timestamp: string): void {
    const conversation = this.store.getConversation(conversationId);
    if (!conversation || conversation.title !== "新对话") return;
    const firstUserMessage = this.store.listMessages(conversationId).find((message) => message.role === "user");
    const title = firstUserMessage ? compactTitle(firstUserMessage.content) : "";
    if (!title) return;
    this.store.updateConversation(conversationId, {
      title,
      updated_at: timestamp,
    });
  }

  #appendAgentRunEvent(
    runId: string,
    type: AgentRunEvent["type"],
    payload: Record<string, unknown>,
    timestamp: string
  ): AgentRunEvent {
    const event = this.store.appendRunEvent({
      runId,
      type,
      payload,
      timestamp,
    });
    this.#subscribers.get(runId)?.forEach((subscriber) => subscriber(event));
    return event;
  }

  #timestamp(): string {
    return this.#now().toISOString();
  }

  #messageId(): string {
    return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

export function createAgentHost(options: AgentHostOptions): AgentHost {
  return new AgentHost(options);
}

export type AgentHostServerOptions = {
  host: AgentHost;
};

export type AgentHostHttpServer = {
  nodeServer: Server;
  get url(): string;
  listen(port?: number, hostname?: string): void;
  close(): Promise<void>;
};

type RouteContext = {
  host: AgentHost;
  request: IncomingMessage;
  response: ServerResponse;
  pathname: string;
};

export function createAgentHostServer(options: AgentHostServerOptions): AgentHostHttpServer {
  const nodeServer = createServer((request, response) => {
    void handleRequest({
      host: options.host,
      request,
      response,
      pathname: new URL(request.url ?? "/", "http://localhost").pathname,
    });
  });

  return {
    nodeServer,
    get url() {
      const address = nodeServer.address() as AddressInfo | null;
      if (!address) {
        throw new Error("Agent host server is not listening");
      }
      return `http://${address.address}:${address.port}`;
    },
    listen(port = 0, hostname = "127.0.0.1") {
      nodeServer.listen(port, hostname);
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        nodeServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

async function handleRequest(context: RouteContext): Promise<void> {
  setCorsHeaders(context.response);

  if (context.request.method === "OPTIONS") {
    context.response.writeHead(204).end();
    return;
  }

  try {
    const handled = await route(context);
    if (!handled) {
      writeJson(context.response, 404, { error: "not_found" });
    }
  } catch (error) {
    writeJson(context.response, 500, {
      error: "agent_host_error",
      message: error instanceof Error ? error.message : "Unknown agent host error",
    });
  }
}

async function route(context: RouteContext): Promise<boolean> {
  const { host, request, response, pathname } = context;

  const workspaceConversationsMatch = /^\/workspaces\/([^/]+)\/conversations$/.exec(pathname);
  if (workspaceConversationsMatch) {
    const workspaceId = decodeURIComponent(workspaceConversationsMatch[1] ?? "");
    if (request.method === "GET") {
      writeJson(response, 200, host.listConversations(workspaceId));
      return true;
    }
    if (request.method === "POST") {
      const body = await readJson(request);
      writeJson(response, 201, host.createConversation(workspaceId, optionalString(body.title)));
      return true;
    }
  }

  const workspacePluginsMatch = /^\/workspaces\/([^/]+)\/plugins$/.exec(pathname);
  if (request.method === "GET" && workspacePluginsMatch) {
    const workspaceId = decodeURIComponent(workspacePluginsMatch[1] ?? "");
    const url = new URL(request.url ?? "/", "http://localhost");
    writeJson(response, 200, host.listPluginsForWorkspace(workspaceId, url.searchParams.get("pack_id") ?? "resume"));
    return true;
  }

  const conversationMatch = /^\/conversations\/([^/]+)$/.exec(pathname);
  if (conversationMatch) {
    const conversationId = decodeURIComponent(conversationMatch[1] ?? "");
    if (request.method === "PATCH") {
      const body = await readJson(request);
      writeJson(response, 200, host.updateConversation(conversationId, {
        title: optionalString(body.title),
        pinned: optionalBoolean(body.pinned),
      }));
      return true;
    }
    if (request.method === "DELETE") {
      if (!host.deleteConversation(conversationId)) {
        writeJson(response, 404, { error: "conversation_not_found" });
        return true;
      }
      response.writeHead(204).end();
      return true;
    }
  }

  const conversationMessagesMatch = /^\/conversations\/([^/]+)\/messages$/.exec(pathname);
  if (request.method === "GET" && conversationMessagesMatch) {
    writeJson(response, 200, host.listMessages(decodeURIComponent(conversationMessagesMatch[1] ?? "")));
    return true;
  }

  const conversationRunsMatch = /^\/workspaces\/([^/]+)\/conversations\/([^/]+)\/runs$/.exec(pathname);
  if (request.method === "POST" && conversationRunsMatch) {
    const body = await readJson(request);
    const run = host.startConversationRun(
      decodeURIComponent(conversationRunsMatch[1] ?? ""),
      decodeURIComponent(conversationRunsMatch[2] ?? ""),
      {
        packId: optionalString(body.pack_id),
        message: parseMessageBody(body.message),
        model: optionalString(body.model),
        mutationMode: body.mutation_mode === undefined ? undefined : canvasMutationModeSchema.parse(body.mutation_mode),
        context: objectRecord(body.context),
      }
    );
    writeJson(response, 201, run);
    return true;
  }

  const agentRunEventsMatch = /^\/agent-runs\/([^/]+)\/events$/.exec(pathname);
  if (agentRunEventsMatch) {
    const runId = decodeURIComponent(agentRunEventsMatch[1] ?? "");
    const url = new URL(request.url ?? "/", "http://localhost");
    const afterSequence = Number(url.searchParams.get("after") ?? "-1");
    if (request.method === "GET" && url.searchParams.get("stream") === "1") {
      await streamAgentRunEvents(host, request, response, runId, Number.isFinite(afterSequence) ? afterSequence : -1);
      return true;
    }
    if (request.method === "GET") {
      writeJson(response, 200, host.listAgentRunEvents(runId, Number.isFinite(afterSequence) ? afterSequence : -1));
      return true;
    }
  }

  const agentRunMatch = /^\/agent-runs\/([^/]+)$/.exec(pathname);
  if (request.method === "GET" && agentRunMatch) {
    writeJson(response, 200, host.getAgentRun(decodeURIComponent(agentRunMatch[1] ?? "")));
    return true;
  }

  const runEventsMatch = /^\/runs\/([^/]+)\/events$/.exec(pathname);
  if (request.method === "GET" && runEventsMatch) {
    const runId = decodeURIComponent(runEventsMatch[1] ?? "");
    const url = new URL(request.url ?? "/", "http://localhost");
    const afterSequence = Number(url.searchParams.get("after") ?? "-1");
    await streamEvents(host.runtime, request, response, runId, Number.isFinite(afterSequence) ? afterSequence : -1);
    return true;
  }

  const runMatch = /^\/runs\/([^/]+)$/.exec(pathname);
  if (request.method === "GET" && runMatch) {
    writeJson(response, 200, host.runtime.getRun(decodeURIComponent(runMatch[1] ?? "")));
    return true;
  }

  const inputMatch = /^\/runs\/([^/]+)\/input$/.exec(pathname);
  if (request.method === "POST" && inputMatch) {
    const event = host.runtime.recordUserInput(decodeURIComponent(inputMatch[1] ?? ""), await readJson(request));
    writeJson(response, 200, event);
    return true;
  }

  const cancelMatch = /^\/runs\/([^/]+)\/cancel$/.exec(pathname);
  if (request.method === "POST" && cancelMatch) {
    const body = await readJson(request);
    const event = host.runtime.cancelRun(decodeURIComponent(cancelMatch[1] ?? ""), optionalString(body.reason));
    writeJson(response, 200, event);
    return true;
  }

  const permissionMatch = /^\/permissions\/([^/]+)\/resolve$/.exec(pathname);
  if (request.method === "POST" && permissionMatch) {
    const body = await readJson(request);
    const decision = host.runtime.resolvePermission({
      requestId: decodeURIComponent(permissionMatch[1] ?? ""),
      status: parsePermissionStatus(body.status),
      remember: parsePermissionRemember(body.remember),
    });
    writeJson(response, 200, decision);
    return true;
  }

  return false;
}

async function streamAgentRunEvents(
  host: AgentHost,
  request: IncomingMessage,
  response: ServerResponse,
  runId: string,
  afterSequence: number
): Promise<void> {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  response.flushHeaders();

  const stream = host.streamAgentRunEvents(runId, { afterSequence });
  request.on("close", () => {
    void stream.return?.();
    response.destroy();
  });

  for await (const event of stream) {
    response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  }
}

async function streamEvents(
  runtime: HarnessRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  runId: string,
  afterSequence: number
): Promise<void> {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  response.flushHeaders();

  const stream = runtime.streamEvents(runId, { afterSequence });
  request.on("close", () => {
    void stream.return?.();
    response.destroy();
  });

  for await (const event of stream) {
    response.write(formatSseEvent(event));
  }
}

function formatSseEvent(event: HarnessRunEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function setCorsHeaders(response: ServerResponse): void {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (!text) {
        resolve({});
        return;
      }

      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          resolve(parsed as Record<string, unknown>);
          return;
        }
        reject(new Error("JSON body must be an object"));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function requiredString(value: unknown, field: string): string {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  throw new Error(`${field} must be a non-empty string`);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error("context must be an object");
}

function parseMessageBody(value: unknown): AgentHostStartConversationRunInput["message"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("message must be an object");
  }
  const body = value as Record<string, unknown>;
  return {
    content: requiredString(body.content, "message.content"),
    mentions: zodMentionArray(body.mentions),
  };
}

function zodMentionArray(value: unknown): ContextMention[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("message.mentions must be an array");
  return value.map((mention) => contextMentionSchema.parse(mention));
}

function parsePermissionStatus(value: unknown): "approved" | "denied" {
  if (value === "approved" || value === "denied") {
    return value;
  }
  throw new Error("Permission status must be approved or denied");
}

function parsePermissionRemember(value: unknown): "never" | "run" | "context" | "always" | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "never" || value === "run" || value === "context" || value === "always") {
    return value;
  }
  throw new Error("Permission remember must be never, run, context, or always");
}

function compactTitle(content: string): string {
  return content
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24) || "新对话";
}
