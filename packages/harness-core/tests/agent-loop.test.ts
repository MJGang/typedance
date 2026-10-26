import { describe, expect, it, vi } from "vitest";
import { createHarnessRuntime, type HarnessModelAdapter, type HarnessModelRequest } from "../src";

describe("harness agent loop", () => {
  it("streams model output, invokes agent-scoped tools, and completes the run", async () => {
    const seenRequests: HarnessModelRequest[] = [];
    const model: HarnessModelAdapter = {
      stream: async function* (request) {
        seenRequests.push(request);
        if (seenRequests.length === 2) {
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
          return;
        }
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
        yield { type: "final", output: { needs_tool_result: true } };
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
    expect("skillContext" in (seenRequests[0] ?? {})).toBe(false);
    expect("messages" in (seenRequests[0] ?? {})).toBe(false);
    expect(seenRequests[0]?.availableToolNames).toEqual(["alpha.readContext", "update_plan", "request_user_input"]);
    expect(seenRequests[0]?.availableTools).toEqual([
      expect.objectContaining({
        name: "alpha.readContext",
        origin: "mcp",
      }),
      expect.objectContaining({ name: "update_plan", origin: "system" }),
      expect.objectContaining({ name: "request_user_input", origin: "system" }),
    ]);
    expect(seenRequests).toHaveLength(2);
    expect(seenRequests[1]?.prompt.conversation.find((message) => (
      message.role === "assistant" && message.toolCalls?.[0]?.id === "tool_call_1"
    ))).toMatchObject({
      role: "assistant",
      content: "I will read the active context first.",
      toolCalls: [
        expect.objectContaining({
          id: "tool_call_1",
          name: "alpha.readContext",
        }),
      ],
    });
    expect(seenRequests[1]?.prompt.conversation.find((message) => (
      message.role === "tool" && message.toolCallId === "tool_call_1"
    ))).toMatchObject({
      role: "tool",
      toolCallId: "tool_call_1",
      toolName: "alpha.readContext",
    });
    expect(runtime.getRun(run.id).status).toBe("completed");
    expect(runtime.getEvents(run.id).map((event) => event.type)).toEqual([
      "run.started",
      "model.call.started",
      "model.call.progress",
      "reasoning.summary.delta",
      "assistant.delta",
      "model.call.progress",
      "model.call.completed",
      "tool.call.started",
      "tool.call.completed",
      "model.call.started",
      "model.call.progress",
      "assistant.delta",
      "model.call.completed",
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

  it("only exposes policy-allowed tools that are registered in the runtime", async () => {
    const seenRequests: HarnessModelRequest[] = [];
    const model: HarnessModelAdapter = {
      stream: async function* (request) {
        seenRequests.push(request);
        yield {
          type: "final",
          output: { ok: true },
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
          instruction_files: [],
          tool_names: ["alpha.readContext", "alpha.missingTool"],
        },
      ],
      agents: [
        {
          id: "alpha.primary",
          name: "Alpha Primary Agent",
          role: "primary",
          skill_ids: ["alpha.review"],
          allowed_tool_names: ["alpha.createProposal", "alpha.unregisteredAllowed"],
        },
      ],
    });
    runtime.registerTool({
      name: "alpha.readContext",
      origin: "mcp",
      handler: async () => ({ ok: true }),
    });
    runtime.registerTool({
      name: "alpha.createProposal",
      origin: "mcp",
      handler: async () => ({ ok: true }),
    });
    const run = runtime.createRun({
      capability_policy: { scope_ids: ["context:alpha"] },
      user_message: "Inspect this context",
      context: {},
    });

    await runtime.runAgentTurn({
      runId: run.id,
      agentId: "alpha.primary",
      messages: [{ role: "user", content: "Inspect this context" }],
    });

    expect(seenRequests[0]?.availableToolNames).toEqual(["alpha.readContext", "alpha.createProposal", "update_plan", "request_user_input"]);
  });

  it("groups multiple tool calls from one model pass before returning tool results", async () => {
    const seenRequests: HarnessModelRequest[] = [];
    const model: HarnessModelAdapter = {
      stream: async function* (request) {
        seenRequests.push(request);
        if (seenRequests.length === 2) {
          yield {
            type: "assistant_delta",
            messageId: "msg_1",
            delta: "Both contexts are checked.",
          };
          yield { type: "final", output: { ok: true } };
          return;
        }
        yield {
          type: "assistant_delta",
          messageId: "msg_1",
          delta: "I will inspect both contexts.",
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
          type: "tool_call",
          call: {
            id: "tool_call_2",
            name: "alpha.readContext",
            origin: "mcp",
            input: { context_id: "context_2" },
          },
        };
        yield { type: "final", output: { needs_tool_result: true } };
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
          instruction_files: [],
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
      handler: async (input) => ({ context_id: input.context_id, ok: true }),
    });
    const run = runtime.createRun({
      capability_policy: { scope_ids: ["context:alpha"] },
      user_message: "Inspect these contexts",
    });

    await runtime.runAgentTurn({
      runId: run.id,
      agentId: "alpha.primary",
      messages: [{ role: "user", content: "Inspect these contexts" }],
    });

    const followUpConversation = seenRequests[1]?.prompt.conversation ?? [];
    expect(followUpConversation).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "assistant",
        content: "I will inspect both contexts.",
        toolCalls: [
          expect.objectContaining({ id: "tool_call_1", name: "alpha.readContext" }),
          expect.objectContaining({ id: "tool_call_2", name: "alpha.readContext" }),
        ],
      }),
      expect.objectContaining({
        role: "tool",
        toolCallId: "tool_call_1",
        toolName: "alpha.readContext",
      }),
      expect.objectContaining({
        role: "tool",
        toolCallId: "tool_call_2",
        toolName: "alpha.readContext",
      }),
    ]));
  });

  it("suspends the turn for permission and executes the approved call only once", async () => {
    let passes = 0;
    const model: HarnessModelAdapter = {
      stream: async function* () {
        if (passes++ > 0) { yield { type: "final", output: { done: true } }; return; }
        yield {
          type: "tool_call",
          call: {
            id: "tool_call_permission",
            name: "alpha.readSecret",
            origin: "resource",
            input: { uri: "file:///secret.txt" },
          },
        };
        yield { type: "final", output: { should_not_complete: true } };
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
          instruction_files: [],
          tool_names: ["alpha.readSecret"],
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
      name: "alpha.readSecret",
      origin: "resource",
      requiresPermission: (input) => ({
        kind: "filesystem.read",
        reason: "Read a protected resource.",
        scope: {
          uri: String(input.uri),
          access: "read",
        },
      }),
      handler: async () => ({ secret: true }),
    });
    const run = runtime.createRun({
      capability_policy: { scope_ids: ["context:alpha"] },
      user_message: "Inspect this context",
    });

    const work = runtime.runAgentTurn({
        runId: run.id,
        agentId: "alpha.primary",
        messages: [{ role: "user", content: "Inspect this context" }],
      });
    await vi.waitFor(() => expect(runtime.getRun(run.id).status).toBe("awaiting_permission"));
    const request = runtime.getEvents(run.id).find((event) => event.type === "permission.requested");
    if (request?.type !== "permission.requested") throw new Error("missing approval request");
    runtime.resolvePermission({ requestId: request.request.id, status: "approved", remember: "never" });
    await expect(work).resolves.toEqual({ done: true });
    expect(runtime.getRun(run.id).status).toBe("completed");
    expect(runtime.getEvents(run.id).map((event) => event.type)).toEqual([
      "run.started",
      "model.call.started",
      "model.call.progress",
      "model.call.completed",
      "permission.requested",
      "permission.resolved",
      "tool.call.started",
      "tool.call.completed",
      "model.call.started",
      "model.call.completed",
      "run.completed",
    ]);
  });
});
