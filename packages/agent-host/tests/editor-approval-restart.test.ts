import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { EditorRequest } from "@typedance/contracts";
import { approvalHost, approvalSnapshot, nextManualProposal } from "./helpers/editor-approval-host";

describe("manual approval after a real Host process restart", () => {
  it("keeps the old preview as history, refuses stale execution and regenerates a review proposal against the new editor", async () => {
    const directory = await mkdtemp(join(tmpdir(), "typedance-approval-restart-"));
    const loader = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
    const child = spawn(process.execPath, ["--import", loader, fileURLToPath(new URL("./fixtures/pending-editor-host.ts", import.meta.url)), directory], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let closed = false;
    const exit = once(child, "exit").then(() => { closed = true; });
    let restored: Awaited<ReturnType<typeof approvalHost>> | undefined;
    try {
      const ready = await new Promise<{ runId: string; conversationId: string; requestId: string }>((resolve, reject) => {
        let output = ""; let errors = "";
        child.stderr.on("data", (chunk) => { errors += chunk; });
        child.stdout.on("data", (chunk) => {
          output += chunk;
          const line = output.split(/\r?\n/).find((value) => value.startsWith('{"runId"'));
          if (line) resolve(JSON.parse(line));
        });
        child.once("error", reject);
        child.once("exit", () => reject(new Error(`Host exited before persisting its proposal: ${errors}`)));
      });
      child.kill();
      await exit;
      const fresh = { ...approvalSnapshot, editor_session_id: "after-restart", content_revision: 0 };
      restored = await approvalHost(directory, fresh, true);
      const { host } = restored;
      expect(host.getAgentRun(ready.runId).status).toBe("failed");
      expect(host.listAgentRunEvents(ready.runId)).toContainEqual(expect.objectContaining({ type: "editor_response", payload: expect.objectContaining({ request_id: ready.requestId, error: expect.stringContaining("客户端已重启") }) }));
      expect(host.listAgentRunEvents(ready.runId).at(-1)?.payload.recoverable).toBe(true);
      expect(() => host.beginEditorRequest(ready.runId, ready.requestId)).toThrow("editor_session_ended");
      const run = host.startConversationRun("doc", ready.conversationId, { message: { content: "继续任务，先核对当前画布再给我预览" }, resumeFromRunId: ready.runId,
        mutationMode: "solo", context: { editor_snapshot: fresh } });
      const next = await nextManualProposal(host, run.id, fresh);
      expect(run.mutation_mode).toBe("review");
      expect(next.mode).toBe("review");
      expect(next.editor_session_id).toBe("after-restart");
      expect(next.transaction?.content_revision).toBe(0);
      expect(next.id).not.toBe(ready.requestId);
      expect(restored.requests).toHaveLength(2);
      expect(restored.requests[0].prompt.conversation.some((message) => message.role === "tool" && String(message.content).includes("interrupted"))).toBe(true);
      host.beginEditorRequest(run.id, next.id);
      const applied = { ...fresh, content_revision: 1, doc_json: next.transaction!.doc_json, plain_text: "新文" };
      host.respondToEditorRequest(run.id, next.id, { status: "applied", snapshot: applied, persisted: true });
      const cursor = host.listAgentRunEvents(run.id).at(-1)!.sequence;
      for await (const event of host.streamAgentRunEvents(run.id, { afterSequence: cursor })) {
        if (event.type === "editor_request") host.respondToEditorRequest(run.id, (event.payload.request as EditorRequest).id, { status: "snapshot", snapshot: applied });
        if (["run_completed", "run_failed"].includes(event.type)) break;
      }
      await host.waitForRun(run.id);
      expect(host.getAgentRun(run.id).status).toBe("completed");
    } finally {
      if (!closed) { child.kill(); await exit; }
      if (restored) {
        for (const run of restored.store.listRuns()) if (run.status === "running") { restored.host.cancelAgentRun(run.id); await restored.host.waitForRun(run.id); }
        restored.store.close();
      }
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
