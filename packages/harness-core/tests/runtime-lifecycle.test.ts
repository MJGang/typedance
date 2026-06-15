import { describe, expect, it } from "vitest";
import { createHarnessRuntime } from "../src";

const fixedNow = () => new Date("2026-06-15T08:00:00.000Z");

describe("harness runtime lifecycle", () => {
  it("streams future events after the requested sequence", async () => {
    const runtime = createHarnessRuntime({ now: fixedNow });
    const run = runtime.createRun({
      user_message: "开始检查简历",
    });

    const stream = runtime.streamEvents(run.id, { afterSequence: 0 });
    const next = stream.next();

    runtime.appendReasoningSummaryDelta(run.id, "reasoning_1", "需要先确认简历来源。");

    const emitted = await next;
    expect(emitted.done).toBe(false);
    expect(emitted.value.type).toBe("reasoning.summary.delta");

    await stream.return?.();
  });

  it("completes, fails, cancels, and records user input with run status updates", () => {
    const runtime = createHarnessRuntime({ now: fixedNow });
    const completedRun = runtime.createRun({
      user_message: "检查简历",
    });
    const failedRun = runtime.createRun({
      user_message: "检查另一份简历",
    });
    const canceledRun = runtime.createRun({
      user_message: "取消这份检查",
    });

    runtime.recordUserInput(completedRun.id, { message: "确认继续。" });
    runtime.completeRun(completedRun.id, { summary: "检查完成。" });
    runtime.failRun(failedRun.id, {
      code: "model_failed",
      message: "模型调用失败。",
    });
    runtime.cancelRun(canceledRun.id, "用户取消。");

    expect(runtime.getRun(completedRun.id).status).toBe("completed");
    expect(runtime.getRun(failedRun.id).status).toBe("failed");
    expect(runtime.getRun(canceledRun.id).status).toBe("canceled");
    expect(runtime.getEvents(completedRun.id).map((event) => event.type)).toEqual([
      "run.started",
      "user.input.received",
      "run.completed",
    ]);
    expect(runtime.getEvents(failedRun.id).at(-1)?.type).toBe("run.failed");
    expect(runtime.getEvents(canceledRun.id).at(-1)?.type).toBe("run.canceled");
  });
});
