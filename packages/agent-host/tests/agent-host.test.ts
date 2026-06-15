import { once } from "node:events";
import { createHarnessRuntime, type HarnessModelAdapter, type HarnessModelRequest } from "@typedance/harness-core";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentHost, createAgentHostServer, type AgentHostHttpServer } from "../src";

const servers: AgentHostHttpServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("agent host", () => {
  it("maps a pack run to a harness capability policy and primary agent", async () => {
    const seenRequests: HarnessModelRequest[] = [];
    const model: HarnessModelAdapter = {
      stream: async function* (request) {
        seenRequests.push(request);
        yield {
          type: "assistant_delta",
          messageId: "msg_1",
          delta: "Reading the resume workspace.",
        };
        yield {
          type: "final",
          output: { summary: "Queued resume review." },
        };
      },
    };
    const runtime = createHarnessRuntime({ model });
    runtime.registerPlugin({
      id: "resume.agent",
      name: "Resume Agent",
      version: "0.1.0",
      module_format: "esm",
      scopes: ["pack:resume"],
      skills: [
        {
          id: "resume.workspace",
          name: "Resume Workspace",
          description: "Read resume workspace.",
          instruction_files: ["skills/workspace.md"],
          tool_names: ["resume.getWorkspaceView"],
        },
      ],
      agents: [
        {
          id: "resume.primary",
          name: "Resume Primary",
          role: "primary",
          skill_ids: ["resume.workspace"],
        },
      ],
    });

    const host = createAgentHost({
      runtime,
      packs: [
        {
          id: "resume",
          capabilityPolicy: { scopeIds: ["pack:resume"] },
          primaryAgentId: "resume.primary",
        },
      ],
    });
    const run = host.startPackRun("resume", {
      action: "quality_review",
      userMessage: "检查当前简历",
      context: { document_id: "doc_1" },
    });
    await host.waitForRun(run.id);

    expect(run.capability_policy).toEqual({ scope_ids: ["pack:resume"], plugin_ids: [] });
    expect(seenRequests).toHaveLength(1);
    expect(seenRequests[0]?.agentId).toBe("resume.primary");
    expect(seenRequests[0]?.context).toMatchObject({
      action: "quality_review",
      document_id: "doc_1",
      pack_id: "resume",
    });
    expect(runtime.getRun(run.id).status).toBe("completed");
  });

  it("exposes pack-scoped run creation over HTTP", async () => {
    const runtime = createHarnessRuntime({
      model: {
        stream: async function* () {
          yield { type: "final", output: { ok: true } };
        },
      },
    });
    runtime.registerPlugin({
      id: "resume.agent",
      name: "Resume Agent",
      version: "0.1.0",
      module_format: "esm",
      scopes: ["pack:resume"],
      agents: [{ id: "resume.primary", name: "Resume Primary", role: "primary", skill_ids: [] }],
    });
    const host = createAgentHost({
      runtime,
      packs: [
        {
          id: "resume",
          capabilityPolicy: { scopeIds: ["pack:resume"], pluginIds: ["resume.agent"] },
          primaryAgentId: "resume.primary",
        },
      ],
    });
    const server = createAgentHostServer({ host });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server.nodeServer, "listening");

    const response = await fetch(`${server.url}/packs/resume/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "import_old_resume",
        user_message: "导入并重构旧简历",
        context: { document_id: "doc_import" },
      }),
    });

    expect(response.status).toBe(201);
    const run = await response.json();
    expect(run.capability_policy).toEqual({
      scope_ids: ["pack:resume"],
      plugin_ids: ["resume.agent"],
    });
    await host.waitForRun(run.id);
    expect(runtime.getRun(run.id).status).toBe("completed");
  });
});
