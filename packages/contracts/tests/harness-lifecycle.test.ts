import { describe, expect, it } from "vitest";
import { harnessRunEventSchema } from "../src";

const timestamp = "2026-06-15T08:00:00.000Z";

describe("harness lifecycle event schemas", () => {
  it("validates cancellation and user input events", () => {
    const canceled = harnessRunEventSchema.parse({
      id: "evt_1",
      run_id: "run_1",
      sequence: 1,
      type: "run.canceled",
      created_at: timestamp,
      reason: "用户取消了当前任务。",
    });

    const userInput = harnessRunEventSchema.parse({
      id: "evt_2",
      run_id: "run_1",
      sequence: 2,
      type: "user.input.received",
      created_at: timestamp,
      input: {
        message: "这段经历是真实的，可以继续。",
      },
    });

    expect(canceled.type).toBe("run.canceled");
    expect(userInput.type).toBe("user.input.received");
  });
});
