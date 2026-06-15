import {
  harnessRunRequestSchema,
  harnessRunSchema,
  type HarnessRun,
  type HarnessRunRequest,
  type HarnessRunStatus,
} from "@typedance/harness-contracts";

export class HarnessRunStore {
  #runs = new Map<string, HarnessRun>();
  #nextId = 1;
  #now: () => Date;

  constructor(now: () => Date) {
    this.#now = now;
  }

  create(input: HarnessRunRequest): HarnessRun {
    const request = harnessRunRequestSchema.parse(input);
    const timestamp = this.#now().toISOString();
    const run = harnessRunSchema.parse({
      id: `run_${this.#nextId++}`,
      capability_policy: request.capability_policy,
      status: "running",
      created_at: timestamp,
      updated_at: timestamp,
    });

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
    const updated = harnessRunSchema.parse({
      ...existing,
      status,
      updated_at: this.#now().toISOString(),
    });
    this.#runs.set(runId, updated);
    return updated;
  }
}
