import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { harnessCheckpointSchema, type HarnessCheckpoint } from "@typedance/harness-contracts";
import type { HarnessCheckpointStore } from "@typedance/harness-core";
import { renameWithWindowsRetry } from "./store";

/** 由宿主完成本地持久化；Core 仅调用存储接口。 */
export class JsonFileHarnessCheckpointStore implements HarnessCheckpointStore {
  constructor(readonly directory: string) {}

  #path(runId: string): string {
    if (!runId || runId.length > 160) throw new Error("Invalid checkpoint run id");
    return join(this.directory, `run-${encodeURIComponent(runId)}.json`);
  }
  load(runId: string): HarnessCheckpoint | undefined {
    const path = this.#path(runId);
    if (!existsSync(path)) return undefined;
    const checkpoint = harnessCheckpointSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    if (checkpoint.run.id !== runId) throw new Error("Checkpoint identity mismatch");
    return checkpoint;
  }
  save(checkpoint: HarnessCheckpoint): void {
    const parsed = harnessCheckpointSchema.parse(checkpoint);
    mkdirSync(this.directory, { recursive: true });
    const target = this.#path(parsed.run.id);
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(parsed), { encoding: "utf8", flag: "wx", flush: true, mode: 0o600 });
      renameWithWindowsRetry(temporary, target);
    } catch (error) {
      try { unlinkSync(temporary); } catch { /* Preserve the last committed checkpoint. */ }
      throw error;
    }
  }
  delete(runId: string): void {
    const path = this.#path(runId);
    try { unlinkSync(path); }
    catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
  }
}
