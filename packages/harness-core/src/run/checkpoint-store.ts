import { harnessCheckpointSchema, type HarnessCheckpoint } from "@typedance/harness-contracts";

export type HarnessCheckpointStore = {
  load(runId: string): HarnessCheckpoint | undefined;
  save(checkpoint: HarnessCheckpoint): void;
  delete(runId: string): void;
};

export class MemoryHarnessCheckpointStore implements HarnessCheckpointStore {
  #checkpoints = new Map<string, HarnessCheckpoint>();
  load(runId: string): HarnessCheckpoint | undefined {
    const value = this.#checkpoints.get(runId);
    return value && structuredClone(value);
  }
  save(checkpoint: HarnessCheckpoint): void {
    const parsed = harnessCheckpointSchema.parse(checkpoint);
    this.#checkpoints.set(parsed.run.id, parsed);
  }
  delete(runId: string): void { this.#checkpoints.delete(runId); }
}

export type HarnessCompletionCheck = (input: {
  checkpoint: HarnessCheckpoint;
  output: Record<string, unknown>;
  signal: AbortSignal;
}) => Promise<{ complete: true } | { complete: false; message: string }> | { complete: true } | { complete: false; message: string };

export type HarnessExecutionLimits = { maxModelSteps?: number; maxTotalTokens?: number };

export class HarnessExecutionError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
