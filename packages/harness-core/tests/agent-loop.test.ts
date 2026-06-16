import { describe, expect, it } from "vitest";
import { createHarnessRuntime, type HarnessModelAdapter, type HarnessModelRequest } from "../src";

describe("harness agent loop", () => {
  it("streams model output, invokes agent-scoped tools, and completes the run", async () => {
    const seenRequests: HarnessModelRequest[] = [];
    const model: HarnessModelAdapter = {
      stream: async function* (request) {
        seenRequests.push(request);
        yield {
          type: "reasoning_summary_delta",
          summaryId: "reasoning_1",
          delta: "Need to read the active context before suggesting changes.",
        };
        yield {
          type: "assistant_delta",
          messageId: "msg_1",
          delta: "I will read the active context first.",
        };
        yield {
          type: "tool_call",
          call: {
            id: "tool_call_1",
            name: "alpha.readContext",
            origin: "mcp",
            input: { context_id: "context_1" },
          },
        };
        yield {
          type: "assistant_delta",
          messageId: "msg_1",
          delta: "I found the current issues and can suggest a focused change.",
        };
        yield {
          type: "final",
          output: {
            summary: "Inspection complete.",
          },
        };
      },
    };

    const runtime = createHarnessRuntime({ model });
    runtime.registerPlugin({
      id: "alpha.agent",
      name: "Alpha Agent",
      version: "0.1.0",
      module_format: "esm",
      scopes: ["context:alpha"],
      skills: [
        {
          id: "alpha.review",
          name: "Alpha Review",
          description: "Review context quality.",
          instruction_files: ["skills/review.md"],
          tool_names: ["alpha.readContext"],
        },
      ],
      agents: [
        {
          id: "alpha.primary",
          name: "Alpha Primary Agent",
          role: "primary",
          skill_ids: ["alpha.review"],
        },
      ],
    });
    runtime.registerTool({
      name: "alpha.readContext",
      origin: "mcp",
      handler: async () => ({ context_id: "context_1", issues: ["missing_evidence"] }),
    });

    const run = runtime.createRun({
      capability_policy: { scope_ids: ["context:alpha"] },
      user_message: "Inspect this context",
      context: { context_id: "context_1" },
    });

    const output = await runtime.runAgentTurn({
      runId: run.id,
      agentId: "alpha.primary",
      messages: [{ role: "user", content: "Inspect this context" }],
    });

    expect(output).toEqual({ summary: "Inspection complete." });
    expect(seenRequests[0]?.capabilityPolicy).toEqual({ scopeIds: ["context:alpha"], pluginIds: [] });
    expect(seenRequests[0]?.skillContext.skills.map((skill) => skill.id)).toEqual(["alpha.review"]);
    expect(seenRequests[0]?.availableToolNames).toEqual(["alpha.readContext"]);
    expect(runtime.getRun(run.id).status).toBe("completed");
    expect(runtime.getEvents(run.id).map((event) => event.type)).toEqual([
      "run.started",
      "reasoning.summary.delta",
      "assistant.delta",
      "tool.call.started",
      "tool.call.completed",
      "assistant.delta",
      "run.completed",
    ]);
  });

  it("fails clearly when no model adapter is configured", async () => {
    const runtime = createHarnessRuntime();
    const run = runtime.createRun({
      user_message: "Inspect this context",
    });

    await expect(
      runtime.runAgentTurn({
        runId: run.id,
        agentId: "alpha.primary",
        messages: [{ role: "user", content: "Inspect this context" }],
      })
    ).rejects.toThrow("Harness model adapter is not configured");
  });
});
