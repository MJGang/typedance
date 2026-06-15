import { once } from "node:events";
import { createHarnessRuntime } from "@typedance/harness-core";
import { afterEach, describe, expect, it } from "vitest";
import { createHarnessRunServer, type HarnessRunHttpServer } from "../src";

const servers: HarnessRunHttpServer[] = [];

async function startTestServer() {
  const runtime = createHarnessRuntime();
  const server = createHarnessRunServer({ runtime });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server.nodeServer, "listening");
  return { runtime, server, baseUrl: server.url };
}

async function readSseEvent(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("missing response body");
  }
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes("\n\n")) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  await reader.cancel();
  const dataLine = text.split("\n").find((line) => line.startsWith("data: "));
  if (!dataLine) {
    throw new Error(`missing SSE data line: ${text}`);
  }
  return JSON.parse(dataLine.slice("data: ".length));
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("harness run HTTP server", () => {
  it("creates runs and fetches run state", async () => {
    const { baseUrl } = await startTestServer();

    const createdResponse = await fetch(`${baseUrl}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        capability_policy: {
          scope_ids: ["workspace:alpha"],
          plugin_ids: ["alpha.agent"],
        },
        user_message: "Inspect this workspace",
        context: { workspace_id: "workspace_1" },
      }),
    });

    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json();
    expect(created.capability_policy).toEqual({
      scope_ids: ["workspace:alpha"],
      plugin_ids: ["alpha.agent"],
    });

    const fetchedResponse = await fetch(`${baseUrl}/runs/${created.id}`);
    expect(fetchedResponse.status).toBe(200);
    const fetched = await fetchedResponse.json();
    expect(fetched.status).toBe("running");
  });

  it("streams run events as SSE with replay and follow semantics", async () => {
    const { runtime, baseUrl } = await startTestServer();
    const run = runtime.createRun({
      user_message: "Inspect this workspace",
    });

    const replayResponse = await fetch(`${baseUrl}/runs/${run.id}/events?after=-1`);
    expect(replayResponse.status).toBe(200);
    const replay = await readSseEvent(replayResponse);
    expect(replay.type).toBe("run.started");

    const followResponse = await fetch(`${baseUrl}/runs/${run.id}/events?after=0`);
    const nextEvent = readSseEvent(followResponse);
    runtime.appendAssistantDelta(run.id, "msg_1", "Starting inspection.");
    const followed = await nextEvent;
    expect(followed.type).toBe("assistant.delta");
  });

  it("records user input, cancellation, and permission decisions", async () => {
    const { runtime, baseUrl } = await startTestServer();
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
      handler: async () => ({ text: "workspace" }),
    });
    const run = runtime.createRun({
      user_message: "Read attachment",
    });
    const permissionResult = await runtime.invokeTool(run.id, {
      id: "tool_call_1",
      name: "workspace.readFile",
      origin: "workspace",
      input: { uri: "file:///workspace.txt" },
    });
    if (permissionResult.status !== "permission_required") {
      throw new Error("expected permission request");
    }

    const inputResponse = await fetch(`${baseUrl}/runs/${run.id}/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Continue" }),
    });
    expect(inputResponse.status).toBe(200);
    expect((await inputResponse.json()).type).toBe("user.input.received");

    const permissionResponse = await fetch(`${baseUrl}/permissions/${permissionResult.request.id}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "approved", remember: "run" }),
    });
    expect(permissionResponse.status).toBe(200);
    expect((await permissionResponse.json()).status).toBe("approved");

    const cancelResponse = await fetch(`${baseUrl}/runs/${run.id}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "User canceled" }),
    });
    expect(cancelResponse.status).toBe(200);
    expect((await cancelResponse.json()).type).toBe("run.canceled");
  });
});
