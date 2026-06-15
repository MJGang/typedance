import { describe, expect, it } from "vitest";
import { createHarnessRuntime } from "../src";

const fixedNow = () => new Date("2026-06-15T08:00:00.000Z");

describe("harness memory, workspace, and verification services", () => {
  it("records scoped memory and emits memory update events", () => {
    const runtime = createHarnessRuntime({ now: fixedNow });
    const run = runtime.createRun({
      user_message: "Remember user preference",
    });

    const memory = runtime.remember({
      runId: run.id,
      scope: "global",
      key: "preferred-tone",
      value: { tone: "conservative" },
      summary: "User prefers conservative wording.",
    });

    expect(memory.id).toBe("memory_1");
    expect(runtime.recall({ scope: "global", key: "preferred-tone" })?.value).toEqual({ tone: "conservative" });
    expect(runtime.getEvents(run.id).at(-1)?.type).toBe("memory.updated");
  });

  it("delegates workspace operations to the configured workspace adapter", async () => {
    const runtime = createHarnessRuntime({
      workspace: {
        readText: async (uri) => `text:${uri}`,
        search: async (query) => [{ uri: "file:///workspace.txt", score: 0.8, snippet: query }],
      },
    });

    await expect(runtime.workspace.readText("file:///workspace.txt")).resolves.toBe("text:file:///workspace.txt");
    await expect(runtime.workspace.search("workspace")).resolves.toEqual([
      { uri: "file:///workspace.txt", score: 0.8, snippet: "workspace" },
    ]);
  });

  it("runs verification recipes and emits verification events", async () => {
    const runtime = createHarnessRuntime({ now: fixedNow });
    runtime.registerVerification({
      id: "quality.check",
      name: "Quality Check",
      handler: async () => ({
        status: "passed",
        summary: "Quality check passed.",
      }),
    });

    const run = runtime.createRun({
      user_message: "Check quality",
    });

    const result = await runtime.runVerification(run.id, "quality.check", { workspace_id: "workspace_1" });

    expect(result.status).toBe("passed");
    expect(runtime.getEvents(run.id).map((event) => event.type)).toEqual([
      "run.started",
      "verification.started",
      "verification.completed",
    ]);
  });
});
