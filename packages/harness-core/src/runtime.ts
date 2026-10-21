import type {
  HarnessPermissionDecision,
  HarnessPluginManifest,
  HarnessRun,
  HarnessRunEvent,
  HarnessRunRequest,
  HarnessToolCall,
  HarnessToolResult,
} from "@typedance/harness-contracts";
import { HarnessEventLog } from "./event/event-log";
import { HarnessMemoryStore, type HarnessMemoryRecord, type HarnessMemoryScope } from "./memory/memory-store";
import { HarnessMcpManager, type HarnessMcpServerRegistration } from "./mcp/mcp-manager";
import type { HarnessModelAdapter, HarnessModelMessage, HarnessModelTool, HarnessPromptBundle } from "./model/model-adapter";
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
  #controllers = new Map<string, AbortController>();
  #executing = new Set<string>();

  constructor(options: HarnessRuntimeOptions = {}) {
    this.#now = options.now ?? (() => new Date());
    this.#model = options.model;
    this.events = new HarnessEventLog();
    this.memory = new HarnessMemoryStore(this.#now);
    this.permissions = new HarnessPermissionEngine(this.#now);
    this.runs = new HarnessRunStore(this.#now);
    this.skills = new HarnessSkillRegistry(options.skillContentLoader);
  }

  createRun(request: HarnessRunRequest): HarnessRun {
    const run = this.runs.create(request);
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
    return this.#appendEvent(runId, {
      type: "plan.updated",
      items,
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

    this.#appendEvent(runId, {
      type: "tool.call.started",
      tool_call: call,
    });

    const result = await this.tools.invoke(call, { signal: this.getRunSignal(runId) });
    this.#appendEvent(runId, {
      type: "tool.call.completed",
      result: result.result,
    });
    return result;
  }

  resolvePermission(input: {
    requestId: string;
    status: HarnessPermissionDecision["status"];
    remember?: HarnessPermissionDecision["remember"];
  }): HarnessPermissionDecision {
    const { request, decision } = this.permissions.resolve(input);
    this.runs.updateStatus(request.run_id, decision.status === "approved" ? "running" : "failed");
    this.#appendEvent(request.run_id, {
      type: "permission.resolved",
      decision,
    });
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
    messages: HarnessModelMessage[];
    prompt?: HarnessPromptBundle;
  }): Promise<Record<string, unknown>> {
    this.#assertActive(input.runId);
    if (this.#executing.has(input.runId)) throw new Error(`Run is already executing: ${input.runId}`);
    this.#executing.add(input.runId);
    try {
      return await this.#executeAgentTurn(input);
    } catch (error) {
      if (!isTerminalRunStatus(this.getRun(input.runId).status)) {
        this.failRun(input.runId, { code: "agent_turn_failed", message: error instanceof Error ? error.message : "Agent turn failed" });
      }
      throw error;
    } finally {
      this.#executing.delete(input.runId);
    }
  }

  async #executeAgentTurn(input: {
    runId: string; agentId: string; model?: string; messages: HarnessModelMessage[]; prompt?: HarnessPromptBundle;
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
    const basePrompt = input.prompt ?? {
      developer: [],
      contextual: [],
      conversation: input.messages,
    };
    const conversation = [...basePrompt.conversation];
    const maxModelPasses = 8;

    for (let pass = 0; pass < maxModelPasses; pass += 1) {
      this.#assertActive(input.runId);
      let assistantContent = "";
      const toolCalls: HarnessToolCall[] = [];
      let finalOutput: Record<string, unknown> | undefined;
      const prompt: HarnessPromptBundle = pass === 0
        ? basePrompt
        : {
            developer: basePrompt.developer,
            contextual: basePrompt.contextual,
            conversation: [...conversation],
          };
      const stream = this.#model.stream({
        signal,
        runId: input.runId,
        capabilityPolicy: skillContext.policy,
        agentId: input.agentId,
        model: input.model,
        prompt,
        availableToolNames,
        availableTools,
      });

      for await (const event of cancellableStream(stream, signal)) {
        this.#assertActive(input.runId);
        if (event.type === "reasoning_summary_delta") {
          this.appendReasoningSummaryDelta(input.runId, event.summaryId, event.delta);
          continue;
        }

        if (event.type === "assistant_delta") {
          assistantContent += event.delta;
          this.appendAssistantDelta(input.runId, event.messageId, event.delta);
          continue;
        }

        if (event.type === "tool_call") {
          toolCalls.push(event.call);
          continue;
        }

        finalOutput = event.output;
      }

      if (toolCalls.length > 0) {
        conversation.push({
          role: "assistant",
          content: assistantContent,
          toolCalls,
        });
        for (const call of toolCalls) {
          this.#assertActive(input.runId);
          const result = await this.invokeAgentTool({
            runId: input.runId,
            agentId: input.agentId,
            call,
          });
          this.#assertActive(input.runId);
          if (result.status === "permission_required") {
            const error = {
              code: "agent_tool_permission_required",
              message: `Tool ${call.name} requires permission before the agent can continue.`,
              details: {
                tool_call_id: call.id,
                permission_request_id: result.request.id,
              },
            };
            this.failRun(input.runId, error);
            throw new Error(error.message);
          }
          conversation.push({
            role: "tool",
            toolCallId: call.id,
            toolName: call.name,
            content: serializeToolResultForModel(result),
          });
        }
        continue;
      }

      const output = finalOutput ?? {};
      this.#assertActive(input.runId);
      this.completeRun(input.runId, output);
      return output;
    }

    const error = {
      code: "agent_loop_limit_exceeded",
      message: `Agent turn exceeded ${maxModelPasses} model passes.`,
    };
    this.failRun(input.runId, error);
    throw new Error(error.message);
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
    return this.#modelVisibleToolNames(context).map((name) => {
      const descriptor = this.tools.describe(name);
      return {
        name: descriptor.name,
        origin: descriptor.origin,
        description: descriptor.description,
        inputSchema: descriptor.inputSchema,
      };
    });
  }

  #appendEvent(runId: string, event: Record<string, unknown>): HarnessRunEvent {
    const fullEvent = {
      id: `evt_${runId}_${this.events.nextSequence(runId)}`,
      run_id: runId,
      sequence: this.events.nextSequence(runId),
      created_at: this.#now().toISOString(),
      ...event,
    } as HarnessRunEvent;

    return this.events.append(fullEvent);
  }
}

function serializeToolResultForModel(result: HarnessRuntimeToolResult): string {
  if (result.status === "permission_required") {
    return JSON.stringify({
      status: "permission_required",
      request_id: result.request.id,
    });
  }
  if (result.status === "completed") {
    return JSON.stringify({
      status: result.result.status,
      output: result.result.output,
    });
  }
  return JSON.stringify({
    status: result.result.status,
    error: result.result.error,
  });
}

export function createHarnessRuntime(options: HarnessRuntimeOptions = {}): HarnessRuntime {
  return new HarnessRuntime(options);
}
