import {
  harnessPermissionDecisionSchema,
  harnessPermissionRequestSchema,
  type HarnessPermissionDecision,
  type HarnessPermissionKind,
  type HarnessPermissionRequest,
  type HarnessPermissionScope,
} from "@typedance/harness-contracts";

export type HarnessPermissionRequirement = {
  kind: HarnessPermissionKind;
  reason: string;
  scope: HarnessPermissionScope;
};

export class HarnessPermissionEngine {
  #approved = new Set<string>();
  #decisions = new Map<string, HarnessPermissionDecision>();
  #nextId = 1;
  #nextDecisionId = 1;
  #now: () => Date;
  #requests = new Map<string, HarnessPermissionRequest>();

  constructor(now: () => Date) {
    this.#now = now;
  }

  createRequest(input: {
    runId: string;
    toolCallId?: string;
    requirement: HarnessPermissionRequirement;
  }): HarnessPermissionRequest {
    const request = harnessPermissionRequestSchema.parse({
      id: `perm_${this.#nextId++}`,
      run_id: input.runId,
      tool_call_id: input.toolCallId,
      kind: input.requirement.kind,
      reason: input.requirement.reason,
      scope: input.requirement.scope,
      created_at: this.#now().toISOString(),
    });
    this.#requests.set(request.id, request);
    return request;
  }

  isApproved(input: { runId: string; requirement: HarnessPermissionRequirement }): boolean {
    return this.#rememberKeys(input.runId, input.requirement).some((key) => this.#approved.has(key));
  }

  resolve(input: {
    requestId: string;
    status: "approved" | "denied";
    remember?: "never" | "run" | "context" | "always";
  }): { request: HarnessPermissionRequest; decision: HarnessPermissionDecision } {
    const request = this.#requests.get(input.requestId);
    if (!request) {
      throw new Error(`Unknown permission request: ${input.requestId}`);
    }

    const decision = harnessPermissionDecisionSchema.parse({
      id: `decision_${this.#nextDecisionId++}`,
      request_id: request.id,
      status: input.status,
      remember: input.remember ?? "never",
      created_at: this.#now().toISOString(),
    });

    this.#decisions.set(decision.id, decision);
    if (decision.status === "approved" && decision.remember !== "never") {
      this.#approved.add(this.#decisionKey(decision.remember, request.run_id, request));
    }

    return { request, decision };
  }

  #rememberKeys(runId: string, requirement: HarnessPermissionRequirement): string[] {
    const request = {
      run_id: runId,
      kind: requirement.kind,
      scope: requirement.scope,
    };
    return [
      this.#decisionKey("run", runId, request),
      this.#decisionKey("context", runId, request),
      this.#decisionKey("always", runId, request),
    ];
  }

  #decisionKey(
    remember: "run" | "context" | "always",
    runId: string,
    request: Pick<HarnessPermissionRequest, "run_id" | "kind" | "scope">
  ): string {
    const prefix = remember === "run" ? `run:${runId}` : remember;
    return [prefix, request.kind, request.scope.access, request.scope.uri].join("|");
  }
}
