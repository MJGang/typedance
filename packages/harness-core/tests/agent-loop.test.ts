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
          delta: "Need to read the active workspace before suggesting changes.",
        };
        yield {
          type: "assistant_delta",
          messageId: "msg_1",
          delta: "I will read the active workspace first.",
        };
        yield {
          type: "tool_call",
          call: {
            id: "tool_call_1",
            name: "alpha.readWorkspace",
            origin: "mcp",
            input: { workspace_id: "workspace_1" },
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
      scopes: ["workspace:alpha"],
      skills: [
        {
          id: "alpha.review",
          name: "Alpha Review",
          description: "Review workspace quality.",
          instruction_files: ["skills/review.md"],
          tool_names: ["alpha.readWorkspace"],
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
      name: "alpha.readWorkspace",
      origin: "mcp",
      handler: async () => ({ workspace_id: "workspace_1", issues: ["missing_evidence"] }),
    });

    const run = runtime.createRun({
      capability_policy: { scope_ids: ["workspace:alpha"] },
      user_message: "Inspect this workspace",
      context: { workspace_id: "workspace_1" },
    });

    const output = await runtime.runAgentTurn({
      runId: run.id,
      agentId: "alpha.primary",
      messages: [{ role: "user", content: "Inspect this workspace" }],
    });

    expect(output).toEqual({ summary: "Inspection complete." });
    expect(seenRequests[0]?.capabilityPolicy).toEqual({ scopeIds: ["workspace:alpha"], pluginIds: [] });
    expect(seenRequests[0]?.skillContext.skills.map((skill) => skill.id)).toEqual(["alpha.review"]);
    expect(seenRequests[0]?.availableToolNames).toEqual(["alpha.readWorkspace"]);
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
      user_message: "Inspect this workspace",
    });

    await expect(
      runtime.runAgentTurn({
        runId: run.id,
        agentId: "alpha.primary",
        messages: [{ role: "user", content: "Inspect this workspace" }],
      })
    ).rejects.toThrow("Harness model adapter is not configured");
  });
});
