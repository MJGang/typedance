import type { HarnessRunEvent } from "@typedance/harness-contracts";
import type { HarnessModelRequest, HarnessModelStreamEvent } from "./model/model-adapter";

/** Observers are synchronous, optional, and must never control agent execution. */
export type HarnessRuntimeObserver = {
  onRunEvent?(event: HarnessRunEvent): void;
  onModelStart?(request: HarnessModelRequest): HarnessModelObservation | undefined;
};

export type HarnessModelObservation = {
  onEvent?(event: HarnessModelStreamEvent): void;
  end?(result: { error?: unknown; canceled: boolean }): void;
};

export function observeSafely<T>(observe: () => T): T | undefined {
  try {
    return observe();
  } catch {
    // Telemetry is best effort; observer failures cannot fail or delay a run.
    return undefined;
  }
}
