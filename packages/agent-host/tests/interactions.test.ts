import { once } from "node:events";
import { expect, it, vi } from "vitest";
import { createHarnessRuntime } from "@typedance/harness-core";
import { createAgentHost, createAgentHostServer } from "../src";

it("scopes authenticated decisions to the pending run and resumes a waiting model with user answers", async () => {
  const passes = new Map<string, number>(); let writes = 0;
  const runtime = createHarnessRuntime({ model: { async *stream(request) {
    const pass = passes.get(request.runId) ?? 0; passes.set(request.runId, pass + 1);
    const first = request.prompt.conversation[0]?.content;
    if (pass === 0) yield { type: "tool_call", call: first === "permission" ? { id: "write", name: "test.write", origin: "plugin", input: {} }
      : { id: "question", name: "request_user_input", origin: "system", input: { questions: [{ id: "target", header: "目标", question: "确认目标" }] } } };
    yield { type: "final", output: {} };
  } } });
  runtime.registerPlugin({ id: "test", name: "Test", version: "1", module_format: "esm", scopes: ["test"], agents: [{ id: "a", name: "A", role: "primary", allowed_tool_names: ["test.write"] }] });
  runtime.registerTool({ name: "test.write", origin: "plugin", requiresPermission: () => ({ kind: "filesystem.write", reason: "测试写入", scope: { uri: "test://resource", access: "write" } }), handler: () => { writes++; return {}; } });
  const host = createAgentHost({ runtime, packs: [{ id: "resume", primaryAgentId: "a", capabilityPolicy: { pluginIds: ["test"] } }] });
  const token = "test-interaction-token-01234567890123456789";
  const server = createAgentHostServer({ host, authToken: token }); server.listen(0, "127.0.0.1"); await once(server.nodeServer, "listening");
  const start = (content: string) => host.startConversationRun("ws", host.createConversation("ws").id, { message: { content } });
  const first = start("permission"), second = start("question");
  const post = (path: string, body: unknown, authenticated = true) => fetch(`${server.url}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(authenticated ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  try {
    await vi.waitFor(() => expect(runtime.getRun(first.id).status).toBe("awaiting_permission"));
    await vi.waitFor(() => expect(runtime.getRun(second.id).status).toBe("awaiting_user_input"));
    const request = runtime.getEvents(first.id).find((event) => event.type === "permission.requested")!;
    if (request.type !== "permission.requested") throw new Error("missing request");
    expect((await post(`/agent-runs/${first.id}/permissions/${request.request.id}`, { status: "approved" }, false)).status).toBe(401);
    expect((await post(`/agent-runs/${second.id}/permissions/${request.request.id}`, { status: "approved" })).status).toBe(409);
    expect(writes).toBe(0);
    expect((await post(`/agent-runs/${first.id}/permissions/${request.request.id}`, { status: "approved" })).status).toBe(200);
    expect((await post(`/agent-runs/${second.id}/questions/question`, { answers: { target: "真实目标" } })).status).toBe(200);
    await Promise.all([host.waitForRun(first.id), host.waitForRun(second.id)]);
    expect(writes).toBe(1);
    expect(JSON.stringify(runtime.getCheckpoint(second.id)?.prompt.conversation)).toContain("真实目标");
    expect((await post(`/agent-runs/${first.id}/permissions/${request.request.id}`, { status: "approved" })).status).toBe(409);
  } finally {
    for (const run of [first, second]) if (host.getAgentRun(run.id).status === "running") host.cancelAgentRun(run.id);
    await server.close();
  }
});
