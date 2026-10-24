import {
  harnessRunRequestSchema,
  harnessRunSchema,
  type HarnessRun,
  type HarnessRunRequest,
  type HarnessRunStatus,
} from "@typedance/harness-contracts";

export function isTerminalRunStatus(status: HarnessRunStatus): boolean {
  return status === "completed" || status === "failed" || status === "canceled";
}

const transitions: Record<HarnessRunStatus, readonly HarnessRunStatus[]> = {
  queued: ["running", "failed", "canceled"],
  running: ["awaiting_permission", "awaiting_user_input", "completed", "failed", "canceled"],
  awaiting_permission: ["running", "failed", "canceled"],
  awaiting_user_input: ["running", "failed", "canceled"],
  completed: [], failed: [], canceled: [],
};

export class HarnessRunStore {
  #runs = new Map<string, HarnessRun>();
  #now: () => Date;

  constructor(now: () => Date) {
    this.#now = now;
  }

  create(input: HarnessRunRequest, options: { id?: string } = {}): HarnessRun {
    const request = harnessRunRequestSchema.parse(input);
    const timestamp = this.#now().toISOString();
    const run = harnessRunSchema.parse({
      id: options.id ?? `run_${crypto.randomUUID()}`,
      capability_policy: request.capability_policy,
      status: "running",
      created_at: timestamp,
      updated_at: timestamp,
    });

    if (this.#runs.has(run.id)) throw new Error(`Duplicate harness run: ${run.id}`);
    this.#runs.set(run.id, run);
    return run;
  }

  get(runId: string): HarnessRun {
    const run = this.#runs.get(runId);
    if (!run) {
      throw new Error(`Unknown harness run: ${runId}`);
    }
    return run;
  }

  updateStatus(runId: string, status: HarnessRunStatus): HarnessRun {
    const existing = this.get(runId);
    if (existing.status === status) return existing;
    if (!transitions[existing.status].includes(status)) {
      throw new Error(`Invalid run transition: ${existing.status} -> ${status}`);
    }
    const updated = harnessRunSchema.parse({
      ...existing,
      status,
      updated_at: this.#now().toISOString(),
    });
    this.#runs.set(runId, updated);
    return updated;
  }
}
