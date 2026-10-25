import { describe, expect, it, vi } from "vitest";
import { createHarnessRuntime, HarnessModelError, type HarnessModelAdapter, type HarnessRuntimeOptions } from "../src";

function setup(model: HarnessModelAdapter, options: HarnessRuntimeOptions = {}) {
  const runtime = createHarnessRuntime({ ...options, model });
  runtime.registerPlugin({ id: "test", name: "Test", version: "1", module_format: "esm", scopes: ["test"], agents: [{ id: "test.agent", name: "Test", role: "primary" }] });
  const run = runtime.createRun({ user_message: "Do the work", capability_policy: { scope_ids: ["test"] } });
  const start = () => runtime.runAgentTurn({ runId: run.id, agentId: "test.agent", messages: [{ role: "user", content: "Do the work" }] });
  return { runtime, run, start };
}
const questions = [{ id: "role", header: "求职方向", question: "希望投递什么岗位？", options: [{ label: "前端", description: "强调界面经验" }, { label: "后端", description: "强调服务经验" }] }];

describe("interactive recovery boundaries", () => {
  it("waits for exact question answers, persists them as tool evidence and rejects late or foreign decisions", async () => {
    let pass = 0;
    const test = setup({ async *stream(request) {
      if (pass++ === 0) yield { type: "tool_call", call: { id: "question-call", name: "request_user_input", origin: "system", input: { questions } } };
      else {
        const result = request.prompt.conversation.find((message) => message.role === "tool" && message.toolCallId === "question-call");
        expect(JSON.parse(String(result?.content)).output.answers).toEqual({ role: "全栈" });
      }
      yield { type: "final", output: { done: true } };
    } });
    const work = test.start();
    await vi.waitFor(() => expect(test.runtime.getRun(test.run.id).status).toBe("awaiting_user_input"));
    expect(test.runtime.getCheckpoint(test.run.id)?.pending_tool_calls[0].name).toBe("request_user_input");
    expect(() => test.runtime.answerQuestions(test.run.id, "question-call", { role: "前端", extra: "bad" })).toThrow();
    expect(() => test.runtime.answerQuestions(test.run.id, "foreign", { role: "前端" })).toThrow();
    test.runtime.answerQuestions(test.run.id, "question-call", { role: "全栈" });
    expect(test.runtime.getCheckpoint(test.run.id)?.prompt.conversation).toContainEqual(expect.objectContaining({ role: "tool", toolCallId: "question-call", content: expect.stringContaining("全栈") }));
    await expect(work).resolves.toEqual({ done: true });
    expect(test.runtime.getCheckpoint(test.run.id)?.prompt.conversation).toContainEqual(expect.objectContaining({ role: "tool", toolCallId: "question-call", content: expect.stringContaining("全栈") }));
    expect(() => test.runtime.answerQuestions(test.run.id, "question-call", { role: "后端" })).toThrow();
  });

  it("cancels a waiting question without inventing an answer", async () => {
    const test = setup({ async *stream() { yield { type: "tool_call", call: { id: "q", name: "request_user_input", origin: "system", input: { questions } } }; } });
    const work = test.start();
    const failure = expect(work).rejects.toThrow();
    await vi.waitFor(() => expect(test.runtime.getRun(test.run.id).status).toBe("awaiting_user_input"));
    test.runtime.cancelRun(test.run.id);
    await failure;
    expect(test.runtime.getEvents(test.run.id).some((event) => event.type === "user.questions.answered")).toBe(false);
  });

  it("applies steering while a question is waiting without fabricating an answer", async () => {
    let pass = 0;
    const test = setup({ async *stream(request) {
      if (pass++ === 0) yield { type: "tool_call", call: { id: "q", name: "request_user_input", origin: "system", input: { questions } } };
      else expect(request.prompt.conversation).toContainEqual({ role: "user", content: "不要改了，只检查" });
      yield { type: "final", output: {} };
    } });
    const work = test.start();
    await vi.waitFor(() => expect(test.runtime.getRun(test.run.id).status).toBe("awaiting_user_input"));
    test.runtime.enqueueUserInput(test.run.id, { id: "steer", messages: [{ role: "user", content: "不要改了，只检查" }] });
    await work;
    expect(test.runtime.getEvents(test.run.id).some((event) => event.type === "user.questions.answered")).toBe(false);
    expect(test.runtime.getEvents(test.run.id)).toContainEqual(expect.objectContaining({ type: "interaction.superseded", request_id: "q" }));
  });

  it("supersedes a waiting permission on steering and rejects a late approval", async () => {
    let pass = 0;
    const test = setup({ async *stream() {
      if (pass++ === 0) yield { type: "tool_call", call: { id: "write", name: "test.write", origin: "plugin", input: {} } };
      else expect(test.runtime.getRun(test.run.id).status).toBe("running");
      yield { type: "final", output: {} };
    } });
    test.runtime.plugins.register({ id: "writer", name: "Writer", version: "1", module_format: "esm", scopes: ["test"], agents: [{ id: "writer.agent", name: "Writer", role: "primary", allowed_tool_names: ["test.write"] }] });
    const handler = vi.fn(() => ({}));
    test.runtime.registerTool({ name: "test.write", origin: "plugin", requiresPermission: () => ({ kind: "filesystem.write", reason: "Write test", scope: { uri: "test://file", access: "write" } }), handler });
    const work = test.runtime.runAgentTurn({ runId: test.run.id, agentId: "writer.agent", messages: [{ role: "user", content: "Write" }] });
    await vi.waitFor(() => expect(test.runtime.getRun(test.run.id).status).toBe("awaiting_permission"));
    const request = test.runtime.getEvents(test.run.id).find((event) => event.type === "permission.requested")!;
    test.runtime.enqueueUserInput(test.run.id, { id: "stop-write", messages: [{ role: "user", content: "Do not write" }] });
    await work;
    expect(handler).not.toHaveBeenCalled();
    if (request.type !== "permission.requested") throw new Error("Missing permission request");
    expect(() => test.runtime.resolvePermission({ requestId: request.request.id, status: "approved" })).toThrow("superseded");
  });

  it("retries classified transient failures with the same evidence and a bounded budget", async () => {
    let attempts = 0;
    const test = setup({ async *stream() { if (attempts++ < 2) throw new HarnessModelError("busy", true, 1); yield { type: "final", output: { done: true } }; } }, { modelRetry: { maxRetries: 2 } });
    await expect(test.start()).resolves.toEqual({ done: true });
    expect(attempts).toBe(3);
    expect(test.runtime.getEvents(test.run.id).filter((event) => event.type === "model.retrying")).toHaveLength(2);
  });

  it.each(["permanent", "partial", "exhausted"])("does not hide %s failures", async (mode) => {
    let attempts = 0;
    const test = setup({ async *stream() {
      attempts++;
      if (mode === "partial") yield { type: "assistant_delta", messageId: "m", delta: "partial response" };
      throw new HarnessModelError("failure", mode !== "permanent", 1);
    } }, { modelRetry: { maxRetries: 2 } });
    await expect(test.start()).rejects.toThrow("failure");
    expect(attempts).toBe(mode === "exhausted" ? 3 : 1);
    expect(test.runtime.getRun(test.run.id).status).toBe("failed");
  });

  it("cancels a retry delay promptly", async () => {
    const test = setup({ async *stream() { throw new HarnessModelError("busy", true, 60_000); yield { type: "final", output: {} }; } });
    const work = test.start(); const failure = expect(work).rejects.toThrow();
    await vi.waitFor(() => expect(test.runtime.getEvents(test.run.id).some((event) => event.type === "model.retrying")).toBe(true));
    test.runtime.cancelRun(test.run.id); await failure;
    expect(test.runtime.getRun(test.run.id).status).toBe("canceled");
  });
});
