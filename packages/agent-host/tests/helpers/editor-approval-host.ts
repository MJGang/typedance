import { join } from "node:path";
import type { EditorRequest, EditorSnapshot, EditorTransaction } from "@typedance/contracts";
import { createHarnessRuntime, type HarnessModelRequest } from "@typedance/harness-core";
import { createAgentHost, createSqliteAgentHostStore, JsonFileHarnessCheckpointStore } from "../../src";
import { createResumePluginLoader, registerResumeWorkbenchPlugin } from "../../src/resume-plugin";

export const approvalSnapshot: EditorSnapshot = { document_id: "doc", editor_session_id: "before-restart", content_revision: 2, canvas_version: 1,
  doc_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "原文" }] }] }, plain_text: "原文" };
export async function approvalHost(directory: string, snapshot: EditorSnapshot, recovered = false) {
  const requests: HarnessModelRequest[] = [];
  const loader = createResumePluginLoader();
  const runtime = createHarnessRuntime({ checkpointStore: new JsonFileHarnessCheckpointStore(join(directory, "checkpoints")), skillContentLoader: loader.createSkillContentLoader(),
    model: { async *stream(request) {
      requests.push(request);
      const stage = requests.length;
      const tool = recovered && stage === 1 ? { name: "resume.inspect", input: {} }
        : stage === (recovered ? 2 : 1) ? { name: "resume.edit", input: { catalog_revision: "catalog", content_revision: snapshot.content_revision,
          summary: "将原文改为新文", operations: [{ capability: "text.replace", parameters: { path: [0], text: "原文", replacement: "新文" } }] } } : undefined;
      if (tool) yield { type: "tool_call", call: { id: `${request.runId}-${stage}`, origin: "plugin", ...tool } };
      else yield { type: "assistant_delta", messageId: "answer", delta: "已核对实际结果" };
      yield { type: "final", output: {} };
    } } });
  await registerResumeWorkbenchPlugin(runtime, loader);
  const store = createSqliteAgentHostStore(join(directory, "store.sqlite"));
  const host = createAgentHost({ runtime, store, packs: [{ id: "resume", primaryAgentId: "resume.primary", capabilityPolicy: { scopeIds: ["pack:resume"] } }],
    resumeTools: { supportsImages: () => false, pageReader: async () => { throw new Error("text-only fixture"); }, editor: {
      catalog: async () => ({ revision: "catalog", scope: "current_document", units: {}, operations: [] }),
      inspect: async (current) => ({ text: current.plain_text, content_revision: current.content_revision }),
      prepare: async ({ snapshot: current, summary }): Promise<EditorTransaction> => ({ id: `tx-${current.editor_session_id}`, document_id: current.document_id,
        editor_session_id: current.editor_session_id, content_revision: current.content_revision, before_doc_json: current.doc_json,
        doc_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "新文" }] }] },
        catalog_revision: "catalog", summary, effects: [{ capability: "text.replace", title: "替换文字", effect: "content" }], node_origins: [], text_origins: [] }),
    } } });
  return { host, store, requests };
}
export async function nextManualProposal(host: Awaited<ReturnType<typeof approvalHost>>["host"], runId: string, snapshot: EditorSnapshot): Promise<EditorRequest> {
  for await (const event of host.streamAgentRunEvents(runId)) {
    if (event.type === "editor_request") {
      const request = event.payload.request as EditorRequest;
      if (request.kind === "transaction") return request;
      host.respondToEditorRequest(runId, request.id, { status: "snapshot", snapshot });
    }
    if (event.type === "run_failed") throw new Error(JSON.stringify(event.payload));
  }
  throw new Error("Run ended without a manual proposal");
}
