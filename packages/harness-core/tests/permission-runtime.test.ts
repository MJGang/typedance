import { describe, expect, it } from "vitest";
import { createHarnessRuntime } from "../src";

const fixedNow = () => new Date("2026-06-15T08:00:00.000Z");

describe("harness permission runtime", () => {
  it("stores approved permission decisions and bypasses repeated prompts in the same run", async () => {
    const runtime = createHarnessRuntime({ now: fixedNow });
    runtime.registerTool({
      name: "workspace.readFile",
      origin: "workspace",
      requiresPermission: (input) => ({
        kind: "filesystem.read",
        reason: "Read a user-authorized file.",
        scope: {
          uri: String(input.uri),
          access: "read",
        },
      }),
      handler: async () => ({ text: "workspace content" }),
    });

    const run = runtime.createRun({
      user_message: "Read attachment",
    });

    const first = await runtime.invokeTool(run.id, {
      id: "tool_call_1",
      name: "workspace.readFile",
      origin: "workspace",
      input: { uri: "file:///C:/Users/test/Documents/workspace.txt" },
    });

    expect(first.status).toBe("permission_required");
    if (first.status !== "permission_required") {
      throw new Error("expected permission request");
    }
    expect(runtime.getRun(run.id).status).toBe("awaiting_permission");

    runtime.resolvePermission({
      requestId: first.request.id,
      status: "approved",
      remember: "run",
    });

    const second = await runtime.invokeTool(run.id, {
      id: "tool_call_2",
      name: "workspace.readFile",
      origin: "workspace",
      input: { uri: "file:///C:/Users/test/Documents/workspace.txt" },
    });

    expect(second.status).toBe("completed");
    expect(runtime.getRun(run.id).status).toBe("running");
    expect(runtime.getEvents(run.id).map((event) => event.type)).toEqual([
      "run.started",
      "permission.requested",
      "permission.resolved",
      "tool.call.started",
      "tool.call.completed",
    ]);
  });
});
