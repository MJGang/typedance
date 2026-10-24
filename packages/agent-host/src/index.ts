import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createLocalAccess, HttpError, readJson, type LocalAccessOptions } from "./local-access";
import type { AddressInfo } from "node:net";
import type { HarnessRun, HarnessRunEvent } from "@typedance/harness-contracts";
import { withRunSignal, type HarnessRuntime, type HarnessModelMessage } from "@typedance/harness-core";
import {
  canvasMutationModeSchema,
  contextMentionSchema,
  editorReferencesSchema,
  editorSnapshotSchema,
  editorResponseSchema,
  modelSettingsUpdateSchema,
  harnessAttachmentsSchema,
  speechPreferencesSchema,
  type HarnessAttachment,
  type AgentConversation,
  type AgentMessage,
  type AgentPluginSummary,
  type AgentRun,
  type AgentRunEvent,
  type CanvasMutationMode,
  type ContextMention,
  type EditorReference,
  type EditorSnapshot,
} from "@typedance/contracts";
import { formatReferencedMessage } from "./editor-references";
import { registerResumeTools, type ResumeToolServices } from "./resume-tools";
import { EditorSession } from "./editor-session";
import {
  createMemoryAgentHostStore,
  type AgentHostStore,
} from "./store";
import { buildAgentHostPromptBundle } from "./prompt";
import type { AgentHostContextProvider } from "./sidecar-context";
import type { ModelSettingsService } from "./model-settings";
import type { LocalSpeechService } from "./speech";
export {
  JsonFileAgentHostStore,
  MemoryAgentHostStore,
  createJsonFileAgentHostStore,
  createMemoryAgentHostStore,
  type AgentHostStore,
  type AgentHostStoreSnapshot,
} from "./store";
export {
  createFileModelSettings,
  type ModelSettingsService,
  type ResolvedModelSettings,
} from "./model-settings";
export {
  createSidecarContextProvider,
  type AgentHostContextProvider,
  type AgentHostContextProviderInput,
  type SidecarContextProviderOptions,
} from "./sidecar-context";
export {
  createDeepSeekModelAdapter,
  type DeepSeekModelAdapterOptions,
} from "./model/deepseek";
export { createLangfuseTelemetry, type LangfuseTelemetry } from "./observability/langfuse";
export {
  buildAgentHostPromptBundle,
  collectPromptFragments,
  createAgentHostPromptDebugSnapshot,
  renderAgentHostPromptSections,
  type AgentHostPromptContributor,
  type AgentHostPromptBundleInput,
  type AgentHostPromptDebugSnapshot,
  type AgentHostPromptFragment,
} from "./prompt";

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
    references?: EditorReference[];
    attachments?: HarnessAttachment[];
  };
  model?: string;
  mutationMode?: CanvasMutationMode;
  context?: Record<string, unknown>;
};

export type AgentHostOptions = {
  runtime: HarnessRuntime;
  packs: AgentHostPackDefinition[];
  store?: AgentHostStore;
  defaultModel?: string;
  contextProvider?: AgentHostContextProvider;
  resumeTools?: ResumeToolServices;
  now?: () => Date;
};

export class AgentHost {
  readonly runtime: HarnessRuntime;
  readonly store: AgentHostStore;
  #packs = new Map<string, AgentHostPackDefinition>();
  #runTasks = new Map<string, Promise<Record<string, unknown> | undefined>>();
  #activeConversations = new Set<string>();
  #runtimeRunIds = new Map<string, string>();
  #activePacks = new Map<string, AgentHostPackDefinition>();
  #subscribers = new Map<string, Set<(event: AgentRunEvent) => void>>();
  #defaultModel?: string;
  #contextProvider?: AgentHostContextProvider;
  #now: () => Date;
  #resumeTools?: ReturnType<typeof registerResumeTools>;
  #editorSessions = new Map<string, EditorSession>();

  constructor(options: AgentHostOptions) {
    this.runtime = options.runtime;
    this.store = options.store ?? createMemoryAgentHostStore();
    this.#defaultModel = options.defaultModel;
    this.#contextProvider = options.contextProvider;
    this.#now = options.now ?? (() => new Date());
    if (options.resumeTools) this.#resumeTools = registerResumeTools(this.runtime, options.resumeTools);
    for (const pack of options.packs) {
      if (this.#packs.has(pack.id)) {
        throw new Error(`Duplicate agent host pack: ${pack.id}`);
      }
      this.#packs.set(pack.id, pack);
    }
    this.#recoverInterruptedRuns();
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

  createConversation(workspaceId: string, name?: string | null): AgentConversation {
    return this.store.createConversation({
      workspaceId,
      name,
      timestamp: this.#timestamp(),
    });
  }

  updateConversation(
    conversationId: string,
    patch: Partial<Pick<AgentConversation, "name" | "pinned">>
  ): AgentConversation {
    const cleanedPatch: Partial<Pick<AgentConversation, "name" | "pinned">> = {};
    if (patch.name !== undefined) cleanedPatch.name = patch.name;
    if (patch.pinned !== undefined) cleanedPatch.pinned = patch.pinned;
    return this.store.updateConversation(conversationId, {
      ...cleanedPatch,
      updated_at: this.#timestamp(),
    });
  }

  deleteConversation(conversationId: string): boolean {
    if (this.#activeConversations.has(conversationId)) throw new HttpError(409, "conversation_run_active");
    return this.store.deleteConversation(conversationId);
  }

  listMessages(conversationId: string): AgentMessage[] {
    return this.store.listMessages(conversationId);
  }

  getConversationActiveRun(conversationId: string): AgentRun | null {
    return this.store.listRuns(conversationId).find((run) => run.status === "running") ?? null;
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

  getEditorRequest(runId: string, requestId: string) {
    const session = this.#editorSessions.get(runId);
    if (!session) throw new HttpError(409, "editor_session_ended");
    try { return session.pending(requestId); }
    catch (error) { throw new HttpError(409, error instanceof Error ? error.message : "editor_request_ended"); }
  }

  respondToEditorRequest(runId: string, requestId: string, response: unknown): void {
    // 确认包可能在服务端成功后丢失；同一个请求只确认一次，重试不能再次触发编辑。
    const previous = this.store.listRunEvents(runId).find((event) => event.type === "editor_response" && event.payload.request_id === requestId);
    if (previous) {
      const parsed = editorResponseSchema.parse(response);
      if (parsed.status !== previous.payload.status || parsed.snapshot?.content_revision !== previous.payload.content_revision) throw new HttpError(409, "editor_response_conflict");
      return;
    }
    const session = this.#editorSessions.get(runId);
    if (!session) throw new HttpError(409, "editor_session_ended");
    try { session.respond(requestId, response); }
    catch (error) { throw new HttpError(409, error instanceof Error ? error.message : "invalid_editor_response"); }
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
    if (this.#activeConversations.has(conversationId)) throw new HttpError(409, "conversation_run_active");

    const timestamp = this.#timestamp();
    const { content, mentions, references, attachments, editorSnapshot } = prepareConversationInput(workspaceId, input);
    const mutationMode = canvasMutationModeSchema.parse(input.mutationMode ?? "review");
    const userMessage = this.store.appendMessage({
      message: {
        id: this.#messageId(),
        conversation_id: conversationId,
        role: "user",
        content,
        mentions,
        ...(references.length > 0 ? { references } : {}),
        ...(attachments.length > 0 ? { attachments } : {}),
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
    const model = input.model ?? this.#defaultModel;
    const agentRun = this.store.createRun({
      run: {
        conversation_id: conversationId,
        assistant_message_id: assistantMessage.id,
        status: "running",
        model,
        mutation_mode: mutationMode,
        started_at: timestamp,
      },
    });
    const context = {
      ...pack.defaultContext,
      ...input.context,
      pack_id: pack.id,
      workspace_id: workspaceId,
      conversation_id: conversationId,
      agent_run_id: agentRun.id,
      user_message_id: userMessage.id,
      assistant_message_id: assistantMessage.id,
      mutation_mode: mutationMode,
      mentions,
      editor_snapshot: editorSnapshot,
      references,
      ...(model ? { model } : {}),
    };
    const harnessRun = this.runtime.createRun({
      capability_policy: {
        scope_ids: [...new Set(pack.capabilityPolicy.scopeIds ?? [])],
        plugin_ids: [...new Set(pack.capabilityPolicy.pluginIds ?? [])],
      },
      user_message: content,
      context,
    });
    this.#runtimeRunIds.set(agentRun.id, harnessRun.id);
    this.#activePacks.set(agentRun.id, pack);
    this.store.updateMessage(assistantMessage.id, { run_id: agentRun.id });
    const firstUserMessage = conversation.first_user_message ?? content;
    this.store.updateConversation(conversationId, {
      first_user_message: firstUserMessage,
      preview: conversation.preview.trim() ? conversation.preview : firstUserMessage,
      status: "running",
      last_message_at: timestamp,
      updated_at: timestamp,
    });

    this.#activeConversations.add(conversationId);
    const projector = this.#projectHarnessEvents(harnessRun.id, agentRun.id, assistantMessage.id, conversationId);
    const task = this.#startAgentTurn(pack, harnessRun, conversationId, assistantMessage.id, content, mentions, model, context);
    const combinedTask = (async () => {
      let output: Record<string, unknown> | undefined;
      try {
        output = await task;
      } catch {
        output = undefined;
      }
      await projector;
      return output;
    })();
    this.#runTasks.set(agentRun.id, combinedTask);
    void combinedTask.finally(() => {
      this.#runTasks.delete(agentRun.id);
      this.#runtimeRunIds.delete(agentRun.id);
      this.#activePacks.delete(agentRun.id);
      this.#activeConversations.delete(conversationId);
    });
    return agentRun;
  }

  async waitForRun(runId: string): Promise<Record<string, unknown> | undefined> {
    return this.#runTasks.get(runId);
  }

  cancelAgentRun(runId: string, reason?: string): HarnessRunEvent {
    const run = this.getAgentRun(runId);
    const runtimeRunId = this.#runtimeRunIds.get(runId);
    if (!runtimeRunId || run.status !== "running") throw new HttpError(409, "agent_run_not_active");
    return this.runtime.cancelRun(runtimeRunId, reason);
  }

  async steerAgentRun(runId: string, input: Pick<AgentHostStartConversationRunInput, "message" | "context">): Promise<AgentMessage> {
    const run = this.getAgentRun(runId);
    const runtimeRunId = this.#runtimeRunIds.get(runId);
    if (!runtimeRunId || run.status !== "running") throw new HttpError(409, "agent_run_not_active");
    const conversation = this.store.getConversation(run.conversation_id)!;
    const prepared = prepareConversationInput(conversation.workspace_id, input);
    const signal = this.runtime.getRunSignal(runtimeRunId);
    const runtimeRun = this.runtime.getRun(runtimeRunId);
    const pack = this.#activePacks.get(runId)!;
    const session = this.#editorSessions.get(runId);
    if (session && prepared.editorSnapshot && prepared.editorSnapshot.editor_session_id !== session.snapshot.editor_session_id) {
      throw new HttpError(409, "editor_session_changed");
    }
    const contextItems = await withRunSignal(this.#contextProvider?.loadContext({
      workspaceId: conversation.workspace_id, mentions: prepared.mentions, signal,
      ...(prepared.editorSnapshot ? { editorSnapshot: prepared.editorSnapshot } : {}),
    }) ?? Promise.resolve([]), signal);
    const skillContext = await withRunSignal(this.runtime.buildAgentSkillContext({ policy: {
      scopeIds: runtimeRun.capability_policy.scope_ids, pluginIds: runtimeRun.capability_policy.plugin_ids,
    }, agentId: pack.primaryAgentId }), signal);
    const contextual = buildAgentHostPromptBundle({ messages: [], skillContext, contextItems }).contextual;
    const message: AgentMessage = {
      id: this.#messageId(), conversation_id: run.conversation_id, role: "user", content: prepared.content,
      mentions: prepared.mentions, run_id: runId, created_at: this.#timestamp(),
      ...(prepared.references.length ? { references: prepared.references } : {}),
      ...(prepared.attachments.length ? { attachments: prepared.attachments } : {}),
    };
    // Admission and persistence have no await between them: an ended run cannot accept an orphan message.
    if (isTerminalHarnessRunStatus(this.runtime.getRun(runtimeRunId).status)) throw new HttpError(409, "agent_run_not_active");
    this.runtime.enqueueUserInput(runtimeRunId, { id: message.id, messages: [toModelMessage(message)], contextual });
    this.store.appendMessage({ message });
    if (session && prepared.editorSnapshot && prepared.editorSnapshot.content_revision >= session.snapshot.content_revision) session.snapshot = prepared.editorSnapshot;
    this.store.updateConversation(run.conversation_id, { last_message_at: message.created_at, updated_at: message.created_at });
    return message;
  }

  streamAgentRunEvents(runId: string, options: { afterSequence?: number } = {}): AsyncIterableIterator<AgentRunEvent> {
    const run = this.getAgentRun(runId);
    const pending = this.store.listRunEvents(runId, options.afterSequence ?? -1);
    const waiting: Array<(value: IteratorResult<AgentRunEvent>) => void> = [];
    let closed = run.status !== "running";

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
    if (!closed) {
      subscribers.add(subscriber);
      this.#subscribers.set(runId, subscribers);
    }

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
    conversationId: string,
    assistantMessageId: string,
    userMessage: string,
    mentions: ContextMention[],
    model: string | undefined,
    context: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const signal = this.runtime.getRunSignal(run.id);
    try {
      const editorSnapshot = context.editor_snapshot as EditorSnapshot | undefined;
      if (editorSnapshot) {
        const runId = String(context.agent_run_id);
        const session = new EditorSession({ snapshot: editorSnapshot, mode: canvasMutationModeSchema.parse(context.mutation_mode), signal,
          emit: (type, payload) => { this.#appendAgentRunEvent(runId, type, payload, this.#timestamp()); } });
        this.#editorSessions.set(runId, session);
        this.#resumeTools?.enter(signal, { session, model });
      }
      signal.throwIfAborted();
      const { messages, contextItems, inputIds } = await withRunSignal(this.#buildModelMessages(conversationId, assistantMessageId, mentions, userMessage, context, signal), signal);
      signal.throwIfAborted();
      const skillContext = await withRunSignal(this.runtime.buildAgentSkillContext({
        policy: {
          scopeIds: pack.capabilityPolicy.scopeIds ?? [],
          pluginIds: pack.capabilityPolicy.pluginIds ?? [],
        },
        agentId: pack.primaryAgentId,
      }), signal);
      const prompt = buildAgentHostPromptBundle({
        messages,
        skillContext,
        contextItems,
      });
      return await this.runtime.runAgentTurn({
        runId: run.id,
        agentId: pack.primaryAgentId,
        model,
        messages,
        prompt,
        inputIds,
      });
    } catch (error) {
      if (!isTerminalHarnessRunStatus(this.runtime.getRun(run.id).status)) {
        this.runtime.failRun(run.id, {
          code: "agent_turn_failed",
          message: error instanceof Error ? error.message : "Agent turn failed",
        });
      }
      throw error;
    } finally {
      this.#resumeTools?.leave(signal);
      this.#editorSessions.delete(String(context.agent_run_id));
    }
  }

  async #buildModelMessages(
    conversationId: string,
    assistantMessageId: string,
    mentions: ContextMention[],
    userMessage: string,
    context: Record<string, unknown>,
    signal: AbortSignal
  ) {
    const storedMessages = this.store.listMessages(conversationId);
    const eventsByRun = new Map(storedMessages.filter((message) => message.role === "assistant" && message.run_id)
      .map((message) => [message.run_id!, this.store.listRunEvents(message.run_id!)] as const));
    const runEvents = [...eventsByRun.values()].flat();
    const consumedInputs = new Set(runEvents.flatMap((event) => {
      const runtimeEvent = event.payload.event as Partial<Extract<HarnessRunEvent, { type: "model.input.consumed" }>> | undefined;
      return event.type === "harness_event" && runtimeEvent?.type === "model.input.consumed" && Array.isArray(runtimeEvent.input_ids) ? runtimeEvent.input_ids : [];
    }));
    const pendingInputs = storedMessages.filter((message) => message.role === "user" && message.id !== context.user_message_id && !consumedInputs.has(message.id));
    const history = buildConversationModelHistory(storedMessages.filter((message) => message.id !== assistantMessageId),
      (runId) => eventsByRun.get(runId) ?? [], storedMessages);
    const fallback = [{ role: "user" as const, content: userMessage }];
    const contextInput = {
      workspaceId: String(context.workspace_id ?? ""),
      mentions: [...mentions, ...pendingInputs.flatMap((message) => message.mentions)],
      signal,
      ...(context.editor_snapshot ? { editorSnapshot: context.editor_snapshot as EditorSnapshot } : {}),
    };
    const contextItems = await this.#contextProvider?.loadContext(contextInput) ?? [];
    const readMessages = new Set(runEvents
      .filter((event) => event.type === "attachments_read").map((event) => event.payload.message_id));
    const inputIds = [...new Set([String(context.user_message_id), ...pendingInputs.map((message) => message.id), ...storedMessages
      .filter((message) => message.role === "user" && message.attachments?.length && !readMessages.has(message.id)).map((message) => message.id)])];
    return { messages: history.length > 0 ? history : fallback, contextItems, inputIds };
  }

  async #projectHarnessEvents(
    runtimeRunId: string,
    agentRunId: string,
    assistantMessageId: string,
    conversationId: string
  ): Promise<void> {
    const stream = this.runtime.streamEvents(runtimeRunId, { afterSequence: -1 });
    for await (const event of stream) {
      this.#recordProjectedEvent(agentRunId, assistantMessageId, conversationId, event);
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
    if (event.type === "model.input.consumed") {
      this.#appendAgentRunEvent(runId, "harness_event", { event }, timestamp);
      for (const messageId of event.input_ids) {
        const message = this.store.getMessage(messageId);
        if (!message?.attachments?.length) continue;
        this.#appendAgentRunEvent(runId, "attachments_read", {
          message_id: messageId,
          attachment_ids: message.attachments.map((attachment) => attachment.id),
          image_count: message.attachments.filter((attachment) => attachment.content.type === "image").length,
          file_count: message.attachments.filter((attachment) => attachment.content.type !== "image").length,
        }, timestamp);
      }
      return;
    }
    if (event.type === "user.input.received") {
      this.#appendAgentRunEvent(runId, "user_input_received", { message_id: event.input.id }, timestamp);
      return;
    }
    if (event.type === "user.input.applied") {
      this.#appendAgentRunEvent(runId, "user_input_applied", { message_id: event.input_id }, timestamp);
      return;
    }
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
      this.#appendAgentRunEvent(
        runId,
        event.result.status === "failed" ? "tool_call_failed" : "tool_call_completed",
        { result: event.result },
        timestamp
      );
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

  #recoverInterruptedRuns(): void {
    const timestamp = this.#timestamp();
    const runningRuns = this.store.listRuns().filter((run) => run.status === "running");
    for (const run of runningRuns) {
      this.#completeProjectedRun(run.id, run.conversation_id, "failed", timestamp);
      this.#appendAgentRunEvent(run.id, "run_failed", {
        error: {
          code: "agent_host_restarted",
          message: "Agent Host restarted before the run finished.",
        },
      }, timestamp);
    }
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

function isTerminalHarnessRunStatus(status: HarnessRun["status"]): boolean {
  return status === "completed" || status === "failed" || status === "canceled";
}

export function createAgentHost(options: AgentHostOptions): AgentHost {
  return new AgentHost(options);
}

export type AgentHostServerOptions = LocalAccessOptions & {
  host: AgentHost;
  modelSettings?: ModelSettingsService;
  speech?: LocalSpeechService;
};

export type AgentHostHttpServer = {
  nodeServer: Server;
  get url(): string;
  listen(port?: number, hostname?: string): void;
  close(): Promise<void>;
};

type RouteContext = {
  host: AgentHost;
  modelSettings?: ModelSettingsService;
  speech?: LocalSpeechService;
  request: IncomingMessage;
  response: ServerResponse;
  pathname: string;
  authorize: ReturnType<typeof createLocalAccess>;
};

export function createAgentHostServer(options: AgentHostServerOptions): AgentHostHttpServer {
  const authorize = createLocalAccess(options);
  const nodeServer = createServer((request, response) => {
    void handleRequest({
      authorize,
      host: options.host,
      modelSettings: options.modelSettings,
      speech: options.speech,
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
  try {
    if (context.authorize(context.request, context.response, context.pathname)) return;
    const handled = await route(context);
    if (!handled) {
      writeJson(context.response, 404, { error: "not_found" });
    }
  } catch (error) {
    if (context.response.destroyed) return;
    if (error instanceof HttpError) {
      if (error.status === 413) context.response.setHeader("connection", "close");
      writeJson(context.response, error.status, { error: error.code });
      return;
    }
    writeJson(context.response, 500, {
      error: "agent_host_error",
      message: error instanceof Error ? error.message : "Unknown agent host error",
    });
  }
}

async function route(context: RouteContext): Promise<boolean> {
  const { host, modelSettings, request, response, pathname } = context;

  if (context.speech && pathname.startsWith("/speech/")) {
    const speech = context.speech;
    if (pathname === "/speech/settings" && request.method === "GET") { writeJson(response, 200, await speech.status()); return true; }
    if (pathname === "/speech/settings" && request.method === "PUT") {
      const parsed = speechPreferencesSchema.safeParse(await readJson(request));
      if (!parsed.success) throw new HttpError(400, "invalid_speech_settings");
      writeJson(response, 200, await speech.configure(parsed.data)); return true;
    }
    if (pathname === "/speech/prepare" && request.method === "POST") { writeJson(response, 202, await speech.prepare()); return true; }
    if (pathname === "/speech/prepare" && request.method === "DELETE") { writeJson(response, 200, await speech.cancelPreparation()); return true; }
    if (pathname === "/speech/transcribe" && request.method === "POST") {
      const body = await readJson(request);
      const abort = new AbortController();
      const cancel = () => { if (!response.writableEnded) abort.abort(); };
      response.once("close", cancel);
      try { writeJson(response, 200, await speech.transcribe(body, abort.signal)); }
      finally { response.off("close", cancel); }
      return true;
    }
  }

  if (request.method === "GET" && pathname === "/health") {
    writeJson(response, 200, { status: "ok", service: "agent-host" });
    return true;
  }

  if (modelSettings && pathname === "/settings/model") {
    if (request.method === "GET") {
      writeJson(response, 200, await modelSettings.get());
      return true;
    }
    if (request.method === "PUT") {
      const parsed = modelSettingsUpdateSchema.safeParse(await readJson(request));
      if (!parsed.success) throw new HttpError(400, "invalid_model_settings");
      writeJson(response, 200, await modelSettings.update(parsed.data));
      return true;
    }
  }

  if (modelSettings && request.method === "DELETE" && pathname === "/settings/model/api-key") {
    writeJson(response, 200, await modelSettings.clearApiKey());
    return true;
  }

  const workspaceConversationsMatch = /^\/workspaces\/([^/]+)\/conversations$/.exec(pathname);
  if (workspaceConversationsMatch) {
    const workspaceId = decodeURIComponent(workspaceConversationsMatch[1] ?? "");
    if (request.method === "GET") {
      writeJson(response, 200, host.listConversations(workspaceId));
      return true;
    }
    if (request.method === "POST") {
      const body = await readJson(request);
      writeJson(response, 201, host.createConversation(workspaceId, optionalName(body.name)));
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
        name: optionalName(body.name),
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

  const activeRunMatch = /^\/conversations\/([^/]+)\/active-run$/.exec(pathname);
  if (request.method === "GET" && activeRunMatch) {
    writeJson(response, 200, host.getConversationActiveRun(decodeURIComponent(activeRunMatch[1] ?? "")));
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

  const editorRequestMatch = /^\/agent-runs\/([^/]+)\/editor-requests\/([^/]+)$/.exec(pathname);
  if (editorRequestMatch) {
    const runId = decodeURIComponent(editorRequestMatch[1]!);
    const requestId = decodeURIComponent(editorRequestMatch[2]!);
    if (request.method === "GET") {
      writeJson(response, 200, host.getEditorRequest(runId, requestId));
      return true;
    }
    if (request.method === "POST") {
      host.respondToEditorRequest(runId, requestId, await readJson(request));
      writeJson(response, 200, { status: "accepted" });
      return true;
    }
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

  const agentRunInputMatch = /^\/agent-runs\/([^/]+)\/input$/.exec(pathname);
  if (request.method === "POST" && agentRunInputMatch) {
    const body = await readJson(request);
    const message = await host.steerAgentRun(decodeURIComponent(agentRunInputMatch[1]!), {
      message: parseMessageBody(body.message), context: objectRecord(body.context),
    });
    writeJson(response, 201, message);
    return true;
  }

  const agentRunCancelMatch = /^\/agent-runs\/([^/]+)\/cancel$/.exec(pathname);
  if (request.method === "POST" && agentRunCancelMatch) {
    const runId = decodeURIComponent(agentRunCancelMatch[1] ?? "");
    if (host.getAgentRun(runId).status !== "running") {
      response.writeHead(204).end();
      return true;
    }
    const body = await readJson(request);
    const event = host.cancelAgentRun(runId, optionalString(body.reason));
    writeJson(response, 200, event);
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
  const stream = host.streamAgentRunEvents(runId, { afterSequence });
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  response.flushHeaders();

  response.on("close", () => {
    void stream.return?.();
    response.destroy();
  });

  for await (const event of stream) {
    await writeStreamChunk(response, `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    if (event.type === "run_completed" || event.type === "run_failed" || event.type === "run_cancelled") break;
  }
  response.end();
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
  response.on("close", () => {
    void stream.return?.();
    response.destroy();
  });

  for await (const event of stream) {
    await writeStreamChunk(response, formatSseEvent(event));
    if (event.type === "run.completed" || event.type === "run.failed" || event.type === "run.canceled") break;
  }
  response.end();
}

function formatSseEvent(event: HarnessRunEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function writeStreamChunk(response: ServerResponse, chunk: string): Promise<void> {
  if (response.destroyed || response.write(chunk)) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      response.off("drain", done);
      response.off("close", done);
      resolve();
    };
    response.once("drain", done);
    response.once("close", done);
  });
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
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

function optionalName(value: unknown): string | null | undefined {
  if (value === null) return null;
  return optionalString(value);
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

function prepareConversationInput(workspaceId: string, input: Pick<AgentHostStartConversationRunInput, "message" | "context">) {
  const content = input.message.content.trim();
  if (!content) throw new HttpError(400, "message.content must be non-empty");
  const mentions = (input.message.mentions ?? []).map((mention) => contextMentionSchema.parse(mention));
  const references = parseEditorReferences(input.message.references);
  const attachments = parseAttachments(input.message.attachments);
  const snapshotResult = input.context?.editor_snapshot === undefined ? undefined : editorSnapshotSchema.safeParse(input.context.editor_snapshot);
  if (snapshotResult && !snapshotResult.success) throw new HttpError(400, "invalid_editor_snapshot");
  const editorSnapshot = snapshotResult?.data;
  if (references.some((reference) => reference.document_id !== workspaceId)
    || (editorSnapshot && editorSnapshot.document_id !== workspaceId)
    || new Set(references.map((reference) => reference.id)).size !== references.length
    || references.some((reference) => reference.source.kind === "canvas" && (!editorSnapshot || reference.source.editor_session_id !== editorSnapshot.editor_session_id || reference.source.content_revision !== editorSnapshot.content_revision))) {
    throw new HttpError(400, "invalid_editor_reference");
  }
  if (editorSnapshot && JSON.stringify(editorSnapshot.doc_json).length > 500_000) throw new HttpError(400, "editor_snapshot_too_large");
  return { content, mentions, references, attachments, editorSnapshot };
}

function toModelMessage(message: AgentMessage): HarnessModelMessage {
  const text = formatReferencedMessage(message.content, message.references);
  return message.role === "user" && message.attachments?.length
    ? { role: "user", content: [{ type: "text", text }, ...message.attachments.map((attachment) => attachment.content.type === "image"
      ? attachment.content : { type: "text" as const, text: `附件：${attachment.name}\n${attachment.content.text}` })] }
    : { role: message.role, content: text };
}

/** Replay response boundaries and consumed steering in the same order the model saw them. */
function buildConversationModelHistory(messages: AgentMessage[], eventsForRun: (runId: string) => AgentRunEvent[], allMessages: AgentMessage[]): HarnessModelMessage[] {
  const byId = new Map(allMessages.map((message) => [message.id, message]));
  return messages.flatMap((message): HarnessModelMessage[] => {
    if (message.role === "user" && message.run_id) return [];
    if (message.role !== "assistant" || !message.run_id) return [toModelMessage(message)];
    const history: HarnessModelMessage[] = [];
    const applied = new Set<string>();
    let responseId: unknown;
    for (const event of eventsForRun(message.run_id)) {
      if (event.type === "assistant_delta") {
        const last = history[history.length - 1];
        const delta = String(event.payload.delta ?? "");
        if (last?.role === "assistant" && responseId === event.payload.message_id) last.content += delta;
        else history.push({ role: "assistant", content: delta });
        responseId = event.payload.message_id;
      } else if (event.type === "user_input_applied") {
        const id = String(event.payload.message_id);
        const steering = byId.get(id);
        if (steering) history.push(toModelMessage(steering));
        applied.add(id);
        responseId = undefined;
      }
    }
    // Accepted input remains conversation history even if the run was stopped before consuming it.
    for (const steering of allMessages) {
      if (steering.role === "user" && steering.run_id === message.run_id && !applied.has(steering.id)) history.push(toModelMessage(steering));
    }
    return history;
  });
}

function parseMessageBody(value: unknown): AgentHostStartConversationRunInput["message"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("message must be an object");
  }
  const body = value as Record<string, unknown>;
  return {
    content: requiredString(body.content, "message.content"),
    mentions: zodMentionArray(body.mentions),
    references: parseEditorReferences(body.references),
    attachments: parseAttachments(body.attachments),
  };
}

function parseEditorReferences(value: unknown): EditorReference[] {
  const parsed = editorReferencesSchema.safeParse(value ?? []);
  if (!parsed.success) throw new HttpError(400, "invalid_editor_reference");
  return parsed.data;
}

function parseAttachments(value: unknown): HarnessAttachment[] {
  const parsed = harnessAttachmentsSchema.safeParse(value ?? []);
  if (!parsed.success) throw new HttpError(400, "附件格式无效，最多 6 个，总传输大小不超过 7 MB");
  for (const attachment of parsed.data) {
    if (attachment.content.type !== "image") continue;
    const url = attachment.content.image_url;
    const bytes = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
    const mime = url.slice(5, url.indexOf(";"));
    const valid = mime === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : mime === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : mime === "image/gif" ? /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())
      : bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
    if (!valid || bytes.length !== attachment.size || attachment.mime_type !== mime) throw new HttpError(400, "图片格式或文件大小不正确");
  }
  return parsed.data;
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
