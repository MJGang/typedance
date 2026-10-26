import { randomUUID } from "node:crypto";
import type {
  HarnessPermissionDecision,
  HarnessPluginManifest,
  HarnessRun,
  HarnessRunEvent,
  HarnessRunRequest,
  HarnessToolCall,
  HarnessToolResult,
} from "@typedance/harness-contracts";
import { harnessCheckpointSchema, harnessPlanItemSchema, type HarnessCheckpoint, type HarnessPendingInput } from "@typedance/harness-contracts";
import { MemoryHarnessCheckpointStore, HarnessExecutionError, type HarnessCheckpointStore, type HarnessCompletionCheck, type HarnessExecutionLimits } from "./run/checkpoint-store";
import { restoreCheckpointHistory } from "./run/history";
import { projectContextSnapshots } from "./model/context-projection";
import { HarnessModelError, waitForModelRetry } from "./model/model-error";
import { harnessUserQuestionsSchema, harnessUserAnswersSchema, type HarnessUserQuestion } from "@typedance/harness-contracts";
import { DEFAULT_CONTEXT_WINDOW, TASK_INSTRUCTIONS, COMPACTION_PROMPT, estimatePromptTokens, estimateTextTokens, retainUserMessages, boundToolContent, type HarnessContextWindowOptions } from "./model/context-window";
import { HarnessEventLog } from "./event/event-log";
import { HarnessMemoryStore, type HarnessMemoryRecord, type HarnessMemoryScope } from "./memory/memory-store";
import { HarnessMcpManager, type HarnessMcpServerRegistration } from "./mcp/mcp-manager";
import type { HarnessModelAdapter, HarnessModelMessage, HarnessModelTool, HarnessPromptBundle, HarnessModelRequest, HarnessModelStreamEvent, HarnessModelUsage } from "./model/model-adapter";
import { observeSafely, type HarnessRuntimeObserver } from "./observability";
import { HarnessPermissionEngine, type HarnessPermissionRequirement } from "./permission/permission-engine";
import {
  HarnessPluginRegistry,
  normalizeCapabilityPolicy,
  normalizeContractCapabilityPolicy,
  type HarnessCapabilityPolicyInput,
  type HarnessResolvedCapabilityPolicy,
} from "./plugin/plugin-registry";
import { HarnessRunStore, isTerminalRunStatus } from "./run/run-store";
import { cancellableStream, withRunSignal } from "./run/cancellation";
import {
  HarnessSkillRegistry,
  type HarnessAgentSkillContext,
  type HarnessResolvedSkill,
  type HarnessSkillContentLoader,
} from "./skill/skill-registry";
import { HarnessToolRegistry, type HarnessToolRegistration } from "./tool/tool-registry";
import {
  HarnessVerificationRegistry,
  type HarnessVerificationRegistration,
  type HarnessVerificationResult,
} from "./verification/verification-registry";

export type HarnessRuntimeOptions = {
  now?: () => Date;
  model?: HarnessModelAdapter;
  skillContentLoader?: HarnessSkillContentLoader;
  observer?: HarnessRuntimeObserver;
  checkpointStore?: HarnessCheckpointStore;
  contextWindow?: HarnessContextWindowOptions;
  limits?: HarnessExecutionLimits;
  completionCheck?: HarnessCompletionCheck;
  modelRetry?: { maxRetries?: number; initialDelayMs?: number };
};

export type HarnessRuntimeToolResult =
  | { status: "completed"; result: HarnessToolResult }
  | { status: "failed"; result: HarnessToolResult }
  | {
      status: "permission_required";
      request: ReturnType<HarnessPermissionEngine["createRequest"]>;
    };

export class HarnessRuntime {
  readonly events: HarnessEventLog;
  readonly memory: HarnessMemoryStore;
  readonly mcp = new HarnessMcpManager();
  readonly permissions: HarnessPermissionEngine;
  readonly plugins = new HarnessPluginRegistry();
  readonly runs: HarnessRunStore;
  readonly skills: HarnessSkillRegistry;
  readonly tools = new HarnessToolRegistry();
  readonly verifications = new HarnessVerificationRegistry();

  #now: () => Date;
  #model?: HarnessModelAdapter;
  #observer?: HarnessRuntimeObserver;
  #controllers = new Map<string, AbortController>();
  #executing = new Set<string>();
  #pendingInputs = new Map<string, HarnessPendingInput[]>();
  #states = new Map<string, HarnessCheckpoint>();
  #objectives = new Map<string, string>();
  #checkpoints: HarnessCheckpointStore;
  #contextWindow: typeof DEFAULT_CONTEXT_WINDOW;
  #limits: HarnessExecutionLimits;
  #completionCheck?: HarnessCompletionCheck;
  #modelRetry: { maxRetries: number; initialDelayMs: number };
  #permissionWaiters = new Map<string, (decision: HarnessPermissionDecision | undefined) => void>();
  #supersededPermissions = new Set<string>();
  #questionWaiters = new Map<string, { runId: string; questions: HarnessUserQuestion[]; resolve: (answers: Record<string, string>) => void; reject: (error: Error) => void }>();

  constructor(options: HarnessRuntimeOptions = {}) {
    this.#now = options.now ?? (() => new Date());
    this.#model = options.model;
    this.#observer = options.observer;
    this.#checkpoints = options.checkpointStore ?? new MemoryHarnessCheckpointStore();
    this.#contextWindow = { ...DEFAULT_CONTEXT_WINDOW, ...options.contextWindow };
    this.#limits = options.limits ?? {};
    this.#completionCheck = options.completionCheck;
    this.#modelRetry = { maxRetries: options.modelRetry?.maxRetries ?? 3, initialDelayMs: options.modelRetry?.initialDelayMs ?? 500 };
    if (!Number.isInteger(this.#modelRetry.maxRetries) || this.#modelRetry.maxRetries < 0 || this.#modelRetry.maxRetries > 10
      || !Number.isFinite(this.#modelRetry.initialDelayMs) || this.#modelRetry.initialDelayMs <= 0) throw new Error("Invalid model retry budget");
    for (const [name, value] of Object.entries({ ...this.#contextWindow, ...this.#limits })) {
      if (!Number.isFinite(value) || value <= 0 || (name !== "compactAtRatio" && !Number.isInteger(value))) throw new Error(`Invalid execution budget: ${name}`);
    }
    if (this.#contextWindow.compactAtRatio >= 1) throw new Error("compactAtRatio must be less than 1");
    this.events = new HarnessEventLog();
    this.memory = new HarnessMemoryStore(this.#now);
    this.permissions = new HarnessPermissionEngine(this.#now);
    this.runs = new HarnessRunStore(this.#now);
    this.skills = new HarnessSkillRegistry(options.skillContentLoader);
  }

  createRun(request: HarnessRunRequest, options: { id?: string } = {}): HarnessRun {
    const run = this.runs.create(request, options);
    this.#objectives.set(run.id, request.user_message);
    this.#controllers.set(run.id, new AbortController());
    this.#appendEvent(run.id, {
      type: "run.started",
      capability_policy: run.capability_policy,
      input: {
        user_message: request.user_message,
        context: request.context,
      },
    });
    return run;
  }

  getCheckpoint(runId: string): HarnessCheckpoint | undefined {
    const checkpoint = this.#checkpoints.load(runId);
    return checkpoint && harnessCheckpointSchema.parse(checkpoint);
  }

  deleteCheckpoint(runId: string): void {
    if (this.#executing.has(runId)) throw new Error("Cannot delete the checkpoint of an executing run");
    this.#checkpoints.delete(runId);
  }

  /** One-time import of historical evidence; it is not an execution checkpoint. */
  importHistory(checkpoint: HarnessCheckpoint): void {
    const parsed = harnessCheckpointSchema.parse(checkpoint);
    if (parsed.phase !== "history" || this.getCheckpoint(parsed.run.id) || this.#executing.has(parsed.run.id)) {
      throw new Error("Historical import must be new and have phase history");
    }
    this.#checkpoints.save(parsed);
  }

  getEvents(runId: string): HarnessRunEvent[] {
    return this.events.get(runId);
  }

  getRun(runId: string): HarnessRun {
    return this.runs.get(runId);
  }

  getRunSignal(runId: string): AbortSignal {
    this.runs.get(runId);
    return this.#controllers.get(runId)!.signal;
  }

  streamEvents(runId: string, options: { afterSequence?: number } = {}): AsyncIterableIterator<HarnessRunEvent> {
    return this.events.stream(runId, options);
  }

  appendAssistantDelta(runId: string, messageId: string, delta: string): HarnessRunEvent {
    return this.#appendEvent(runId, {
      type: "assistant.delta",
      message_id: messageId,
      delta,
    });
  }

  appendReasoningSummaryDelta(runId: string, summaryId: string, delta: string): HarnessRunEvent {
    return this.#appendEvent(runId, {
      type: "reasoning.summary.delta",
      summary_id: summaryId,
      delta,
    });
  }

  updatePlan(
    runId: string,
    items: Array<{
      id: string;
      title: string;
      status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
    }>
  ): HarnessRunEvent {
    this.#assertActive(runId);
    const plan = harnessPlanItemSchema.array().parse(items);
    if (new Set(plan.map((item) => item.id)).size !== plan.length || plan.filter((item) => item.status === "in_progress").length > 1) {
      throw new Error("Plan ids must be unique and at most one step can be in progress");
    }
    const state = this.#states.get(runId);
    if (state) { state.plan = plan; this.#saveCheckpoint(state); }
    return this.#appendEvent(runId, {
      type: "plan.updated",
      items: plan,
    });
  }

  proposeArtifactPatch(
    runId: string,
    input: {
      artifactId: string;
      patchId: string;
      summary: string;
      diff?: string;
    }
  ): HarnessRunEvent {
    return this.#appendEvent(runId, {
      type: "artifact.patch.proposed",
      artifact_id: input.artifactId,
      patch_id: input.patchId,
      summary: input.summary,
      diff: input.diff,
    });
  }

  applyArtifactPatch(
    runId: string,
    input: {
      artifactId: string;
      patchId: string;
    }
  ): HarnessRunEvent {
    return this.#appendEvent(runId, {
      type: "artifact.patch.applied",
      artifact_id: input.artifactId,
      patch_id: input.patchId,
    });
  }

  addEvidence(
    runId: string,
    input: {
      evidenceId: string;
      target?: Record<string, unknown>;
      summary: string;
    }
  ): HarnessRunEvent {
    return this.#appendEvent(runId, {
      type: "evidence.added",
      evidence_id: input.evidenceId,
      target: input.target ?? {},
      summary: input.summary,
    });
  }

  startSubagent(
    runId: string,
    input: {
      subagentId: string;
      name: string;
    }
  ): HarnessRunEvent {
    return this.#appendEvent(runId, {
      type: "subagent.started",
      subagent_id: input.subagentId,
      name: input.name,
    });
  }

  completeSubagent(
    runId: string,
    input: {
      subagentId: string;
      status: "completed" | "failed" | "canceled";
      summary?: string;
    }
  ): HarnessRunEvent {
    return this.#appendEvent(runId, {
      type: "subagent.completed",
      subagent_id: input.subagentId,
      status: input.status,
      summary: input.summary,
    });
  }

  recordUserInput(runId: string, input: Record<string, unknown>): HarnessRunEvent {
    this.runs.updateStatus(runId, "running");
    return this.#appendEvent(runId, {
      type: "user.input.received",
      input,
    });
  }

  /** Accept steering for the active run; consume it only between model/tool steps. */
  enqueueUserInput(runId: string, input: { id: string; messages: HarnessModelMessage[]; contextual?: HarnessPromptBundle["contextual"] }): void {
    this.#assertActive(runId);
    if (!input.id || input.messages.length === 0) throw new Error("User input must contain an id and messages");
    const pending = this.#pendingInputs.get(runId) ?? [];
    pending.push(structuredClone({ ...input, contextual: input.contextual ?? [] }));
    this.#pendingInputs.set(runId, pending);
    const state = this.#states.get(runId);
    if (state) this.#saveCheckpoint(state);
    this.#appendEvent(runId, { type: "user.input.received", input: { id: input.id } });
    for (const [key, waiter] of this.#questionWaiters) {
      if (waiter.runId !== runId) continue;
      this.#questionWaiters.delete(key);
      this.#appendEvent(runId, { type: "interaction.superseded", request_id: key.slice(runId.length + 1), kind: "questions" });
      waiter.reject(new HarnessExecutionError("question_superseded", "New user instructions arrived. Reconsider this question using the new instructions."));
    }
    for (const [requestId, resolve] of this.#permissionWaiters) {
      if (this.permissions.getRequest(requestId).run_id !== runId) continue;
      this.#supersededPermissions.add(requestId);
      this.#appendEvent(runId, { type: "interaction.superseded", request_id: requestId, kind: "permissions" });
      resolve(undefined);
    }
  }

  completeRun(runId: string, output: Record<string, unknown> = {}): HarnessRunEvent {
    return this.#finishRun(runId, "completed", {
      type: "run.completed",
      output,
    });
  }

  failRun(runId: string, error: { code: string; message: string; details?: Record<string, unknown> }): HarnessRunEvent {
    return this.#finishRun(runId, "failed", {
      type: "run.failed",
      error,
    });
  }

  cancelRun(runId: string, reason?: string): HarnessRunEvent {
    return this.#finishRun(runId, "canceled", {
      type: "run.canceled",
      reason,
    });
  }

  registerTool(registration: HarnessToolRegistration): HarnessToolRegistration {
    if (["update_plan", "request_user_input"].includes(registration.name)) throw new Error(`${registration.name} is a reserved runtime tool`);
    return this.tools.register(registration);
  }

  registerMcpServer(server: HarnessMcpServerRegistration): HarnessMcpServerRegistration {
    const registered = this.mcp.registerServer(server);
    for (const tool of registered.tools) {
      this.registerTool({
        name: tool.name,
        origin: "mcp",
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        handler: (input, _call, context) => registered.callTool(tool.name, input, context),
      });
    }
    return registered;
  }

  async invokeTool(runId: string, input: HarnessToolCall): Promise<HarnessRuntimeToolResult> {
    this.#assertActive(runId);
    const call = this.tools.parseCall(input);
    const registration = this.tools.get(call.name);
    const requirement = registration.requiresPermission?.(call.input, call);

    if (requirement && !this.permissions.isApproved({ runId, requirement })) {
      this.runs.updateStatus(runId, "awaiting_permission");
      const request = this.permissions.createRequest({
        runId,
        toolCallId: call.id,
        requirement: requirement satisfies HarnessPermissionRequirement,
      });
      this.#appendEvent(runId, {
        type: "permission.requested",
        request,
      });
      return { status: "permission_required", request };
    }

    return this.#executeTool(runId, call);
  }

  async #executeTool(runId: string, call: HarnessToolCall): Promise<HarnessRuntimeToolResult> {
    this.#assertActive(runId);
    this.#appendEvent(runId, {
      type: "tool.call.started",
      tool_call: call,
    });

    const signal = this.getRunSignal(runId);
    const result = await withRunSignal(this.tools.invoke(call, { signal }), signal);
    this.#assertActive(runId);
    const eventResult = { ...result.result };
    delete eventResult.content;
    this.#appendEvent(runId, {
      type: "tool.call.completed",
      result: eventResult,
    });
    return result;
  }

  resolvePermission(input: {
    requestId: string;
    status: HarnessPermissionDecision["status"];
    remember?: HarnessPermissionDecision["remember"];
  }): HarnessPermissionDecision {
    if (this.#supersededPermissions.has(input.requestId)) throw new Error("Permission request was superseded by new user instructions");
    this.#assertActive(this.permissions.getRequest(input.requestId).run_id);
    const { request, decision } = this.permissions.resolve(input);
    this.runs.updateStatus(request.run_id, "running");
    this.#appendEvent(request.run_id, {
      type: "permission.resolved",
      decision,
    });
    this.#permissionWaiters.get(request.id)?.(decision);
    return decision;
  }

  registerPlugin(manifest: HarnessPluginManifest): HarnessPluginManifest {
    return this.plugins.register(manifest);
  }

  resolvePluginsForPolicy(policy: HarnessCapabilityPolicyInput = {}): HarnessPluginManifest[] {
    return this.plugins.resolveForPolicy(policy);
  }

  resolveSkillsForPolicy(policy: HarnessCapabilityPolicyInput = {}): HarnessResolvedSkill[] {
    return this.skills.resolveSkillsForPlugins(this.resolvePluginsForPolicy(policy));
  }

  buildAgentSkillContext(input: {
    policy?: HarnessCapabilityPolicyInput;
    agentId: string;
  }): Promise<HarnessAgentSkillContext> {
    const policy = normalizeCapabilityPolicy(input.policy);
    return this.skills.buildAgentContext({
      policy,
      agentId: input.agentId,
      plugins: this.resolvePluginsForPolicy(policy),
    });
  }

  async invokeAgentTool(input: {
    runId: string;
    agentId: string;
    call: HarnessToolCall;
  }): Promise<HarnessRuntimeToolResult> {
    if (input.call.name === "request_user_input") return this.#requestUserInput(input.runId, input.call);
    if (input.call.name === "update_plan") {
      this.#assertActive(input.runId);
      if (input.call.origin !== "system") throw new Error("Tool origin mismatch for update_plan");
      this.#appendEvent(input.runId, { type: "tool.call.started", tool_call: input.call });
      let result: HarnessToolResult;
      try {
        this.updatePlan(input.runId, harnessPlanItemSchema.array().parse(input.call.input.items));
        result = { tool_call_id: input.call.id, status: "completed", output: { message: "Plan updated" } };
      } catch (error) {
        result = { tool_call_id: input.call.id, status: "failed", error: { code: "invalid_plan", message: error instanceof Error ? error.message : "Invalid plan" } };
      }
      this.#appendEvent(input.runId, { type: "tool.call.completed", result });
      return { status: result.status === "completed" ? "completed" : "failed", result };
    }
    const context = await this.buildAgentSkillContext({
      policy: this.#resolveRunPolicy(input.runId),
      agentId: input.agentId,
    });
    const availableTools = new Set(this.#modelVisibleToolNames(context));
    if (!availableTools.has(input.call.name)) {
      throw new Error(
        `Tool ${input.call.name} is not available for agent ${input.agentId} by the active capability policy and registered tool surface`
      );
    }
    return this.invokeTool(input.runId, input.call);
  }

  async runAgentTurn(input: {
    runId: string;
    agentId: string;
    model?: string;
    modelOptions?: Record<string, unknown>;
    messages: HarnessModelMessage[];
    prompt?: HarnessPromptBundle;
    inputIds?: string[];
    historyInputIds?: string[];
    completionCheck?: HarnessCompletionCheck;
    resumeFromRunId?: string;
  }): Promise<Record<string, unknown>> {
    this.#assertActive(input.runId);
    if (this.#executing.has(input.runId)) throw new Error(`Run is already executing: ${input.runId}`);
    this.#executing.add(input.runId);
    try {
      return await this.#executeAgentTurn(input);
    } catch (error) {
      if (!isTerminalRunStatus(this.getRun(input.runId).status)) {
        this.failRun(input.runId, { code: error instanceof HarnessExecutionError ? error.code : "agent_turn_failed", message: error instanceof Error ? error.message : "Agent turn failed" });
      }
      throw error;
    } finally {
      this.#executing.delete(input.runId);
      this.#states.delete(input.runId);
      this.#objectives.delete(input.runId);
    }
  }

  async #executeAgentTurn(input: {
    runId: string; agentId: string; model?: string; modelOptions?: Record<string, unknown>; messages: HarnessModelMessage[]; prompt?: HarnessPromptBundle; inputIds?: string[]; historyInputIds?: string[]; resumeFromRunId?: string; completionCheck?: HarnessCompletionCheck;
  }): Promise<Record<string, unknown>> {
    const signal = this.getRunSignal(input.runId);
    if (!this.#model) {
      throw new Error("Harness model adapter is not configured");
    }

    const policy = this.#resolveRunPolicy(input.runId);
    const skillContext = await withRunSignal(this.buildAgentSkillContext({
      policy,
      agentId: input.agentId,
    }), signal);
    const availableTools = this.#modelVisibleTools(skillContext);
    const availableToolNames = availableTools.map((tool) => tool.name);
    const basePrompt = structuredClone(input.prompt ?? { developer: [], contextual: [], conversation: input.messages });
    for (const [index, message] of basePrompt.conversation.entries()) {
      if (message.role === "system") basePrompt.developer.push({ slot: "developer", source: `harness.input.system.${index}`, content: message.content });
    }
    basePrompt.conversation = basePrompt.conversation.filter((message) => message.role !== "system");
    const recovered = input.resumeFromRunId ? this.getCheckpoint(input.resumeFromRunId) : undefined;
    if (input.resumeFromRunId && !recovered) throw new Error(`Unknown checkpoint: ${input.resumeFromRunId}`);
    if (recovered && (recovered.phase === "history" || recovered.run.id === input.runId || recovered.agent_id !== input.agentId
      || JSON.stringify([...recovered.run.capability_policy.scope_ids].sort()) !== JSON.stringify([...this.getRun(input.runId).capability_policy.scope_ids].sort())
      || JSON.stringify([...recovered.run.capability_policy.plugin_ids].sort()) !== JSON.stringify([...this.getRun(input.runId).capability_policy.plugin_ids].sort()))) {
      throw new Error("Checkpoint must resume into a new run with the same agent and capability policy");
    }
    const state: HarnessCheckpoint = {
      run: this.getRun(input.runId), agent_id: input.agentId, model: input.model,
      model_options: input.modelOptions ?? recovered?.model_options,
      objective: recovered?.objective ?? this.#objectives.get(input.runId)!,
      prompt: basePrompt, plan: recovered?.plan ?? [], step: recovered?.step ?? 0,
      tokens_used: recovered?.tokens_used ?? 0, compactions: recovered?.compactions ?? 0,
      phase: "ready", pending_tool_calls: [], pending_inputs: [],
      input_ids: [...(recovered?.input_ids ?? []), ...(input.historyInputIds ?? []), ...(input.inputIds ?? [])],
      unconfirmed_input_ids: [...(recovered?.unconfirmed_input_ids ?? []), ...(input.inputIds ?? [])],
    };
    if (recovered) {
      const history = restoreCheckpointHistory(recovered);
      state.prompt.conversation = [...history.messages, ...basePrompt.conversation];
      state.input_ids.push(...history.inputIds);
      state.unconfirmed_input_ids.push(...recovered.pending_inputs.map((pending) => pending.id));
      this.#appendEvent(input.runId, { type: "run.resumed", source_run_id: recovered.run.id });
    }
    state.input_ids = [...new Set(state.input_ids)];
    state.unconfirmed_input_ids = [...new Set(state.unconfirmed_input_ids)];
    this.#states.set(input.runId, state);
    this.#saveCheckpoint(state);

    for (;;) {
      this.#assertActive(input.runId);
      const pendingInputs = this.#pendingInputs.get(input.runId) ?? [];
      this.#pendingInputs.delete(input.runId);
      for (const pending of pendingInputs) {
        state.unconfirmed_input_ids.push(pending.id);
        state.input_ids.push(pending.id);
        state.prompt.conversation.push(...pending.messages);
        for (const section of pending.contextual) {
          const index = state.prompt.contextual.findIndex((existing) => existing.source === section.source && existing.slot === section.slot);
          if (index < 0) state.prompt.contextual.push(section);
          else state.prompt.contextual[index] = section;
        }
        this.#appendEvent(input.runId, { type: "user.input.applied", input_id: pending.id });
      }
      this.#saveCheckpoint(state);
      await this.#compactIfNeeded(state, availableTools, skillContext.policy, signal);
      // Steering received during compaction belongs after the compacted prefix.
      if (this.#pendingInputs.get(input.runId)?.length) continue;
      this.#checkBudget(state);
      const pass = state.step++;
      let assistantContent = "";
      let assistantReasoning = "";
      const toolCalls: HarnessToolCall[] = [];
      let finalOutput: Record<string, unknown> | undefined;
      let incomplete = false;
      const prompt = this.#buildTaskPrompt(state);
      state.prompt.conversation = structuredClone(prompt.conversation);
      state.phase = "model";
      this.#saveCheckpoint(state);
      const estimatedInput = estimatePromptTokens(prompt, availableTools);
      let measuredUsage: number | undefined;
      const stream = this.#streamModel({
        signal,
        runId: input.runId,
        capabilityPolicy: skillContext.policy,
        agentId: input.agentId,
        model: input.model,
        modelOptions: state.model_options,
        prompt,
        availableToolNames,
        availableTools,
        purpose: "response",
      });

      for await (const event of stream) {
        this.#assertActive(input.runId);
        if (state.unconfirmed_input_ids.length) {
          this.#appendEvent(input.runId, { type: "model.input.consumed", input_ids: [...state.unconfirmed_input_ids] });
          state.unconfirmed_input_ids = [];
        }
        if (event.type === "first_token" || event.type === "tool_call_delta") continue;
        if (event.type === "reasoning_summary_delta") {
          assistantReasoning += event.delta;
          this.appendReasoningSummaryDelta(input.runId, `${pass}:${event.summaryId}`, event.delta);
          continue;
        }

        if (event.type === "assistant_delta") {
          assistantContent += event.delta;
          this.appendAssistantDelta(input.runId, `${pass}:${event.messageId}`, event.delta);
          continue;
        }

        if (event.type === "tool_call") {
          toolCalls.push(event.call);
          continue;
        }

        finalOutput = event.output;
        incomplete = event.incomplete ?? false;
        measuredUsage = event.usage?.totalTokens ?? (event.usage
          ? (event.usage.inputTokens ?? estimatedInput) + (event.usage.outputTokens ?? estimateTextTokens(assistantContent + assistantReasoning + JSON.stringify(toolCalls)))
          : undefined);
        state.last_input_tokens = event.usage?.inputTokens;
        state.last_input_estimate = estimatedInput;
      }
      state.tokens_used += measuredUsage ?? estimatedInput + estimateTextTokens(assistantContent + assistantReasoning + JSON.stringify(toolCalls));
      state.phase = "ready";
      if (assistantContent || assistantReasoning || toolCalls.length) state.prompt.conversation.push({ role: "assistant", content: assistantContent,
        ...(assistantReasoning ? { reasoningContent: assistantReasoning } : {}), ...(toolCalls.length ? { toolCalls } : {}) });
      if (incomplete) {
        state.pending_tool_calls = [...toolCalls];
        this.#saveCheckpoint(state);
        throw new HarnessExecutionError("model_response_incomplete", "The model response was cut short; progress was saved and no incomplete tool calls were executed.");
      }
      if (toolCalls.length > 0) {
        state.pending_tool_calls = [...toolCalls];
        state.phase = "tools";
        this.#saveCheckpoint(state);
        for (const call of toolCalls) {
          this.#assertActive(input.runId);
          if (this.#pendingInputs.get(input.runId)?.length) {
            state.prompt.conversation.push({ role: "tool", toolCallId: call.id, toolName: call.name,
              content: "Tool was not executed because new user instructions arrived. Reconsider this action using the new instructions." });
            state.pending_tool_calls.shift();
            this.#saveCheckpoint(state);
            continue;
          }
          state.in_flight_tool_call_id = call.id;
          this.#saveCheckpoint(state);
          let result = await this.invokeAgentTool({
            runId: input.runId,
            agentId: input.agentId,
            call,
          });
          this.#assertActive(input.runId);
          if (result.status === "permission_required") {
            const requestId = result.request.id;
            const known = this.permissions.getDecision(requestId);
            let decision: HarnessPermissionDecision | undefined;
            try {
              if (this.#pendingInputs.get(input.runId)?.length) {
                this.#supersededPermissions.add(requestId);
                this.#appendEvent(input.runId, { type: "interaction.superseded", request_id: requestId, kind: "permissions" });
              } else decision = known ?? await withRunSignal(new Promise<HarnessPermissionDecision | undefined>((resolve) => this.#permissionWaiters.set(requestId, resolve)), signal);
            } finally { this.#permissionWaiters.delete(requestId); }
            this.#assertActive(input.runId);
            if (!decision) this.runs.updateStatus(input.runId, "running");
            if (decision?.status === "approved" && !this.#pendingInputs.get(input.runId)?.length) {
              result = await this.#executeTool(input.runId, call);
            } else {
              result = { status: "failed", result: { tool_call_id: call.id, status: "failed", error: {
                code: "tool_not_authorized", message: "Tool was not executed: permission was denied or new user instructions superseded it.",
              } } };
            }
          }
          if (!state.prompt.conversation.some((message) => message.role === "tool" && message.toolCallId === call.id)) state.prompt.conversation.push({
            role: "tool",
            toolCallId: call.id,
            toolName: call.name,
            content: boundToolContent(serializeToolResultForModel(result), this.#contextWindow.toolOutputTokens),
          });
          state.in_flight_tool_call_id = undefined;
          state.pending_tool_calls = state.pending_tool_calls.filter((pending) => pending.id !== call.id);
          this.#saveCheckpoint(state);
        }
        state.phase = "ready";
        this.#saveCheckpoint(state);
        continue;
      }
      this.#saveCheckpoint(state);
      if (this.#pendingInputs.get(input.runId)?.length) {
        continue;
      }
      const output = finalOutput ?? {};
      let needsContinuation = false;
      for (const check of [this.#completionCheck, input.completionCheck]) {
        if (!check) continue;
        const result = await withRunSignal(Promise.resolve(check({ checkpoint: structuredClone(state), output, signal })), signal);
        this.#assertActive(input.runId);
        if (this.#pendingInputs.get(input.runId)?.length) { needsContinuation = true; break; }
        if (!result.complete) {
          if (!result.message.trim()) throw new Error("Completion check must supply continuation feedback");
          state.prompt.conversation.push({ role: "user", internal: "completion", content: `Completion check requires more work:\n${result.message}` });
          this.#appendEvent(input.runId, { type: "completion.blocked", message: result.message });
          this.#saveCheckpoint(state);
          needsContinuation = true;
          break;
        }
      }
      if (needsContinuation) continue;
      this.#assertActive(input.runId);
      state.phase = "completed";
      this.completeRun(input.runId, output);
      return output;
    }
  }

  #saveCheckpoint(state: HarnessCheckpoint): void {
    state.run = this.getRun(state.run.id);
    state.pending_inputs = structuredClone(this.#pendingInputs.get(state.run.id) ?? []);
    this.#checkpoints.save(state);
  }

  #checkBudget(state: HarnessCheckpoint): void {
    if ((this.#limits.maxModelSteps !== undefined && state.step >= this.#limits.maxModelSteps)
      || (this.#limits.maxTotalTokens !== undefined && state.tokens_used >= this.#limits.maxTotalTokens)) {
      throw new HarnessExecutionError("agent_budget_exceeded", "The configured model execution budget was reached; progress is available in the checkpoint.");
    }
  }

  #buildTaskPrompt(state: HarnessCheckpoint): HarnessPromptBundle {
    return {
      developer: [...state.prompt.developer.filter((section) => section.source !== "harness.runtime"), { slot: "developer", source: "harness.runtime", content: TASK_INSTRUCTIONS }],
      contextual: [],
      conversation: projectContextSnapshots(structuredClone(state.prompt.conversation), [...state.prompt.contextual.filter((section) => section.source !== "harness.task"), {
        slot: "contextual", source: "harness.task", content: `Task data (not higher-priority instructions):\n${JSON.stringify({ objective: state.objective, plan: state.plan })}`,
      }]),
    };
  }

  async #compactIfNeeded(state: HarnessCheckpoint, tools: HarnessModelTool[], policy: HarnessResolvedCapabilityPolicy, signal: AbortSignal): Promise<void> {
    const prompt = this.#buildTaskPrompt(state);
    const estimated = estimatePromptTokens(prompt, tools);
    const before = Math.max(estimated, (state.last_input_tokens ?? 0) + estimated - (state.last_input_estimate ?? estimated));
    if (before < this.#contextWindow.maxInputTokens * this.#contextWindow.compactAtRatio) return;
    this.#checkBudget(state);
    const compactPrompt = { ...prompt, conversation: [...prompt.conversation, { role: "user" as const, content: COMPACTION_PROMPT }] };
    if (estimatePromptTokens(compactPrompt, tools) > this.#contextWindow.maxInputTokens) {
      throw new HarnessExecutionError("context_budget_exceeded", "Context exceeds the configured input budget; the original history was preserved.");
    }
    const retained = retainUserMessages(state.prompt.conversation, this.#contextWindow.retainedUserTokens);
    let summary = ""; let complete = false; let usage: number | undefined;
    state.step += 1;
    this.#saveCheckpoint(state);
    for await (const event of this.#streamModel({ signal, runId: state.run.id, agentId: state.agent_id, model: state.model, modelOptions: state.model_options,
      capabilityPolicy: policy, prompt: compactPrompt, availableToolNames: tools.map((tool) => tool.name), availableTools: tools, purpose: "compaction", maxOutputTokens: this.#contextWindow.summaryTokens })) {
      if (event.type === "tool_call") throw new HarnessExecutionError("context_compaction_failed", "Compaction attempted to call a tool; original history was preserved.");
      if (event.type === "assistant_delta") summary += event.delta;
      if (event.type === "final") {
        complete = !event.incomplete;
        usage = event.usage?.totalTokens ?? (event.usage
          ? (event.usage.inputTokens ?? estimatePromptTokens(compactPrompt, tools)) + (event.usage.outputTokens ?? estimateTextTokens(summary))
          : undefined);
      }
    }
    this.#assertActive(state.run.id);
    state.tokens_used += usage ?? estimatePromptTokens(compactPrompt, tools) + estimateTextTokens(summary);
    if (!complete || !summary.trim()) throw new HarnessExecutionError("context_compaction_failed", "Compaction returned no complete handoff summary; original history was preserved.");
    const conversation: HarnessModelMessage[] = [...retained, { role: "user", internal: "compaction", content: `Context checkpoint from prior work. Continue from this evidence and avoid duplicate actions:\n${summary}` }];
    const candidate = { ...state, prompt: { ...state.prompt, conversation } };
    const after = estimatePromptTokens(this.#buildTaskPrompt(candidate), tools);
    if (after >= estimated || after >= this.#contextWindow.maxInputTokens * this.#contextWindow.compactAtRatio) {
      throw new HarnessExecutionError("context_compaction_failed", "Compaction did not free enough context; original history was preserved.");
    }
    // Persist the replacement before publishing it; failed I/O leaves the live prefix intact.
    candidate.compactions += 1;
    candidate.last_input_tokens = undefined;
    candidate.last_input_estimate = undefined;
    this.#saveCheckpoint(candidate);
    Object.assign(state, candidate);
    this.#appendEvent(state.run.id, { type: "context.compacted", before_tokens: before, after_tokens: after, compaction: state.compactions });
  }

  async *#streamModel(request: HarnessModelRequest): AsyncIterable<HarnessModelStreamEvent> {
    for (let attempt = 0;; attempt++) {
      let emitted = false;
      try {
        for await (const event of this.#observeModel(request)) { emitted = true; yield event; }
        return;
      } catch (error) {
        request.signal.throwIfAborted();
        // A streamed response may already be visible. Keep its failure explicit instead of duplicating it.
        if (emitted || !(error instanceof HarnessModelError) || !error.retryable || attempt >= this.#modelRetry.maxRetries) throw error;
        const delay = error.retryAfterMs ?? Math.min(30_000, this.#modelRetry.initialDelayMs * 2 ** attempt);
        if (!Number.isFinite(delay) || delay < 0 || delay > 60_000) throw error;
        this.#appendEvent(request.runId, { type: "model.retrying", attempt: attempt + 1, max_retries: this.#modelRetry.maxRetries, delay_ms: delay });
        await waitForModelRetry(delay, request.signal);
      }
    }
  }

  async *#observeModel(request: HarnessModelRequest): AsyncIterable<HarnessModelStreamEvent> {
    const callId = randomUUID();
    const started = performance.now();
    const inputTokens = estimatePromptTokens(request.prompt, request.availableTools);
    const systemTokens = 32 + [...request.prompt.developer, ...request.prompt.contextual]
      .reduce((sum, section) => sum + estimateTextTokens(section.source + section.content) + 16, 0);
    const toolTokens = estimateTextTokens(JSON.stringify(request.availableTools));
    this.#appendEvent(request.runId, {
      type: "model.call.started", call_id: callId, model: request.model, purpose: request.purpose ?? "response",
      input_tokens: inputTokens, budget_tokens: this.#contextWindow.maxInputTokens,
      system_tokens: systemTokens, tool_tokens: toolTokens, conversation_tokens: Math.max(0, inputTokens - systemTokens - toolTokens),
    });
    const observation = observeSafely(() => this.#observer?.onModelStart?.(request));
    let error: unknown;
    let ttftMs: number | undefined;
    let usage: HarnessModelUsage | undefined;
    let model = request.model;
    let completed = false;
    let outputText = "";
    let outputCharacters = 0;
    const appendOutput = (text: string) => { outputText += text; for (const _char of text) outputCharacters += 1; };
    const streamedToolCalls = new Set<string>();
    let lastProgressAt = -Infinity;
    let lastOutputTokens = -1;
    const reportProgress = (now: number, force = false) => {
      if (ttftMs === undefined || isTerminalRunStatus(this.getRun(request.runId).status)) return;
      if (!force && now - lastProgressAt < 1000) return;
      const outputTokens = estimateTextTokens(outputText);
      if (force && outputTokens === lastOutputTokens) return;
      this.#appendEvent(request.runId, { type: "model.call.progress", call_id: callId, ttft_ms: ttftMs, output_tokens: outputTokens, output_characters: outputCharacters });
      lastProgressAt = now; lastOutputTokens = outputTokens;
    };
    try {
      for await (const event of cancellableStream(this.#model!.stream(request), request.signal)) {
        if (event.type !== "final") {
          const now = performance.now();
          if (ttftMs === undefined) ttftMs = now - started;
          if (event.type === "assistant_delta" || event.type === "reasoning_summary_delta") appendOutput(event.delta);
          if (event.type === "tool_call_delta") { streamedToolCalls.add(event.callId); appendOutput(event.delta); }
          if (event.type === "tool_call" && !streamedToolCalls.has(event.call.id)) appendOutput(JSON.stringify({ name: event.call.name, arguments: event.call.input }));
          reportProgress(now);
        }
        if (event.type === "final") {
          completed = true; usage = event.usage;
          if (typeof event.output.model === "string") model = event.output.model;
        }
        observeSafely(() => observation?.onEvent?.(event));
        yield event;
      }
    } catch (caught) {
      error = caught;
      throw caught;
    } finally {
      reportProgress(performance.now(), true);
      // 取消可能已关闭事件流，终态后不得追加事件。
      if (!isTerminalRunStatus(this.getRun(request.runId).status)) this.#appendEvent(request.runId, {
        type: "model.call.completed", call_id: callId, model,
        duration_ms: Math.max(0, performance.now() - started), ttft_ms: ttftMs,
        status: request.signal.aborted ? "canceled" : error || !completed ? "failed" : "completed", usage,
      });
      observeSafely(() => observation?.end?.({ error, canceled: request.signal.aborted }));
    }
  }

  remember(input: {
    runId?: string;
    scope: HarnessMemoryScope;
    key: string;
    value: unknown;
    summary: string;
  }): HarnessMemoryRecord {
    const memory = this.memory.remember(input);
    if (input.runId) {
      this.#appendEvent(input.runId, {
        type: "memory.updated",
        memory_id: memory.id,
        scope: memory.scope,
        summary: memory.summary,
      });
    }
    return memory;
  }

  recall(input: { scope: HarnessMemoryScope; key: string }): HarnessMemoryRecord | undefined {
    return this.memory.recall(input);
  }

  registerVerification(registration: HarnessVerificationRegistration): HarnessVerificationRegistration {
    return this.verifications.register(registration);
  }

  async runVerification(
    runId: string,
    verificationId: string,
    input: Record<string, unknown>
  ): Promise<HarnessVerificationResult> {
    const verification = this.verifications.get(verificationId);
    this.#appendEvent(runId, {
      type: "verification.started",
      verification_id: verification.id,
      name: verification.name,
    });

    const result = await verification.handler(input);
    this.#appendEvent(runId, {
      type: "verification.completed",
      verification_id: verification.id,
      status: result.status,
      summary: result.summary,
    });
    return result;
  }

  #resolveRunPolicy(runId: string): HarnessResolvedCapabilityPolicy {
    return normalizeContractCapabilityPolicy(this.runs.get(runId).capability_policy);
  }

  #assertActive(runId: string): void {
    this.getRunSignal(runId).throwIfAborted();
    if (isTerminalRunStatus(this.getRun(runId).status)) throw new Error(`Run has already ended: ${runId}`);
  }

  #finishRun(runId: string, status: "completed" | "failed" | "canceled", event: Record<string, unknown>): HarnessRunEvent {
    if (isTerminalRunStatus(this.getRun(runId).status)) {
      const terminal = this.events.get(runId).find((item) => item.type === "run.completed" || item.type === "run.failed" || item.type === "run.canceled");
      if (!terminal) throw new Error(`Terminal event missing for run: ${runId}`);
      return terminal;
    }
    const state = this.#states.get(runId);
    if (state) {
      const checkpoint = { ...state, run: { ...this.getRun(runId), status, updated_at: this.#now().toISOString() },
        pending_inputs: structuredClone(this.#pendingInputs.get(runId) ?? []) };
      try { this.#checkpoints.save(checkpoint); }
      catch (error) { if (status === "completed") throw error; }
    }
    this.#pendingInputs.delete(runId);
    this.runs.updateStatus(runId, status);
    const terminal = this.#appendEvent(runId, event);
    this.#controllers.get(runId)?.abort(new DOMException(typeof event.reason === "string" ? event.reason : `Run ${status}`, "AbortError"));
    return terminal;
  }

  #modelVisibleToolNames(context: HarnessAgentSkillContext): string[] {
    const policyAllowedNames = [...new Set([...context.toolNames, ...context.agent.allowed_tool_names])];
    return policyAllowedNames.filter((name) => this.tools.has(name));
  }

  #modelVisibleTools(context: HarnessAgentSkillContext): HarnessModelTool[] {
    return [...this.#modelVisibleToolNames(context).map((name) => {
      const descriptor = this.tools.describe(name);
      return {
        name: descriptor.name,
        origin: descriptor.origin,
        description: descriptor.description,
        inputSchema: descriptor.inputSchema,
      };
    }), {
      name: "update_plan", origin: "system", description: "Track a multi-step task with a current plan. A plan records progress, not proof of completion. Keep ids unique and at most one step in progress.",
      inputSchema: { type: "object", properties: { items: { type: "array", items: { type: "object", properties: {
        id: { type: "string" }, title: { type: "string" }, status: { type: "string", enum: ["pending", "in_progress", "completed", "failed", "skipped"] },
      }, required: ["id", "title", "status"], additionalProperties: false } } }, required: ["items"], additionalProperties: false },
    }, {
      name: "request_user_input", origin: "system", description: "Ask 1-3 questions when missing user facts or a consequential choice prevents progress. Wait for actual answers; never guess or request secrets. Optional choices help the user, and free text is always allowed. Do not add an Other option; the user can enter a custom answer directly.",
      inputSchema: { type: "object", properties: { questions: { type: "array", minItems: 1, maxItems: 3, items: {
        type: "object", properties: { id: { type: "string" }, header: { type: "string" }, question: { type: "string" }, options: {
          type: "array", minItems: 2, maxItems: 6, items: { type: "object", properties: { label: { type: "string" }, description: { type: "string" } }, required: ["label", "description"], additionalProperties: false },
        } }, required: ["id", "header", "question"], additionalProperties: false,
      } } }, required: ["questions"], additionalProperties: false },
    }];
  }

  answerQuestions(runId: string, requestId: string, value: unknown): void {
    this.#assertActive(runId);
    const waiter = this.#questionWaiters.get(`${runId}:${requestId}`);
    if (!waiter) throw new Error("Question request is no longer pending");
    const answers = harnessUserAnswersSchema.parse(value);
    if (Object.keys(answers).length !== waiter.questions.length || waiter.questions.some((question) => !answers[question.id])) {
      throw new Error("Answer exactly the requested question ids");
    }
    const state = this.#states.get(runId);
    if (state) {
      const candidate = structuredClone(state);
      candidate.prompt.conversation.push({ role: "tool", toolCallId: requestId, toolName: "request_user_input",
        content: serializeToolResultForModel({ status: "completed", result: { tool_call_id: requestId, status: "completed", output: { answers } } }) });
      candidate.pending_tool_calls = candidate.pending_tool_calls.filter((call) => call.id !== requestId);
      candidate.in_flight_tool_call_id = undefined;
      this.#saveCheckpoint(candidate);
      Object.assign(state, candidate);
    }
    this.#questionWaiters.delete(`${runId}:${requestId}`);
    this.runs.updateStatus(runId, "running");
    this.#appendEvent(runId, { type: "user.questions.answered", request_id: requestId, answers });
    waiter.resolve(answers);
  }

  async #requestUserInput(runId: string, call: HarnessToolCall): Promise<HarnessRuntimeToolResult> {
    this.#assertActive(runId);
    if (call.origin !== "system") throw new Error("Tool origin mismatch for request_user_input");
    this.#appendEvent(runId, { type: "tool.call.started", tool_call: call });
    let result: HarnessToolResult;
    const key = `${runId}:${call.id}`;
    try {
      const { questions } = harnessUserQuestionsSchema.parse(call.input);
      const answer = new Promise<Record<string, string>>((resolve, reject) => this.#questionWaiters.set(key, { runId, questions, resolve, reject }));
      this.runs.updateStatus(runId, "awaiting_user_input");
      this.#appendEvent(runId, { type: "user.questions.requested", request_id: call.id, questions });
      const answers = await withRunSignal(answer, this.getRunSignal(runId));
      result = { tool_call_id: call.id, status: "completed", output: { answers } };
    } catch (error) {
      this.#assertActive(runId);
      this.runs.updateStatus(runId, "running");
      result = { tool_call_id: call.id, status: "failed", error: { code: error instanceof HarnessExecutionError ? error.code : "invalid_user_questions", message: error instanceof Error ? error.message : "Invalid questions" } };
    } finally { this.#questionWaiters.delete(key); }
    this.#appendEvent(runId, { type: "tool.call.completed", result });
    return { status: result.status === "completed" ? "completed" : "failed", result };
  }

  #appendEvent(runId: string, event: Record<string, unknown>): HarnessRunEvent {
    const fullEvent = {
      id: `evt_${runId}_${this.events.nextSequence(runId)}`,
      run_id: runId,
      sequence: this.events.nextSequence(runId),
      created_at: this.#now().toISOString(),
      ...event,
    } as HarnessRunEvent;

    const appended = this.events.append(fullEvent);
    observeSafely(() => this.#observer?.onRunEvent?.(appended));
    return appended;
  }
}

function serializeToolResultForModel(result: HarnessRuntimeToolResult): import("@typedance/harness-contracts").HarnessModelContent {
  if (result.status === "permission_required") {
    return JSON.stringify({
      status: "permission_required",
      request_id: result.request.id,
    });
  }
  if (result.status === "completed") {
    const text = JSON.stringify({
      status: result.result.status,
      output: result.result.output,
    });
    return result.result.content?.length ? [{ type: "text", text }, ...result.result.content] : text;
  }
  return JSON.stringify({
    status: result.result.status,
    error: result.result.error,
  });
}

export function createHarnessRuntime(options: HarnessRuntimeOptions = {}): HarnessRuntime {
  return new HarnessRuntime(options);
}
