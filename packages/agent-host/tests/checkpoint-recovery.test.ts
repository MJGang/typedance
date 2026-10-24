import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

async function launch(directory: string, mode: string, children: ChildProcess[]) {
  const child = fork(fileURLToPath(new URL("./fixtures/checkpoint-process.ts", import.meta.url)), [directory, mode], {
    execArgv: ["--import", "tsx"], stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true,
  });
  children.push(child);
  let stderr = ""; child.stderr?.on("data", (chunk) => { stderr += chunk; });
  const [message] = await Promise.race([once(child, "message"), once(child, "exit").then(() => { throw new Error(`Host exited: ${stderr}`); })]);
  if (message.type !== "listening") throw new Error(`Unexpected startup: ${stderr}`);
  return { child, url: `http://127.0.0.1:${message.port}` };
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exit = once(child, "exit"); child.kill(); await exit;
}
async function post(url: string, body: unknown) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer checkpoint-integration-token-0123456789" }, body: JSON.stringify(body) });
  expect(response.status).toBe(201);
  return response.json();
}

describe("persisted Harness checkpoints through Host HTTP", () => {
  it("recovers a killed Host process in a new run without repeating side effects", async () => {
    const directory = await mkdtemp(join(tmpdir(), "harness-recovery-"));
    const children: ChildProcess[] = [];
    try {
      const first = await launch(directory, "initial", children);
      const conversation = await post(`${first.url}/workspaces/test/conversations`, { name: "Recovery" });
      const inFlight = once(first.child, "message");
      const source = await post(`${first.url}/workspaces/test/conversations/${conversation.id}/runs`, {
        pack_id: "test", message: { content: "Verify both deliverables" },
      });
      expect((await inFlight)[0].type).toBe("in-flight");
      await stop(first.child);
      const second = await launch(directory, "resumed", children);
      const other = await post(`${second.url}/workspaces/test/conversations`, { name: "Other" });
      const forbidden = await fetch(`${second.url}/workspaces/test/conversations/${other.id}/runs`, {
        method: "POST", headers: { "content-type": "application/json", authorization: "Bearer checkpoint-integration-token-0123456789" },
        body: JSON.stringify({ pack_id: "test", message: { content: "Continue" }, resume_from_run_id: source.id }),
      });
      expect(forbidden.status).toBe(409);
      const resumed = await post(`${second.url}/workspaces/test/conversations/${conversation.id}/runs`, {
        pack_id: "test", message: { content: "Continue and verify the actual state" }, resume_from_run_id: source.id,
      });
      expect(resumed.id).not.toBe(source.id);
      const stream = await fetch(`${second.url}/agent-runs/${resumed.id}/events?stream=1`, { headers: { authorization: "Bearer checkpoint-integration-token-0123456789" } });
      const text = await stream.text();
      expect(text).toContain("run_completed");
      expect(text).toContain("Resumed from saved evidence");
      expect(text).not.toContain("run_failed");
      expect((await readFile(join(directory, "invocations.txt"), "utf8")).trim().split(/\r?\n/)).toEqual(["completed", "uncertain"]);
      const checkpoint = JSON.parse(await readFile(join(directory, "checkpoints", `run-${resumed.id}.json`), "utf8"));
      expect(checkpoint.run.status).toBe("completed");
      expect(checkpoint.objective).toBe("Verify both deliverables");
    } finally {
      await Promise.all(children.map(stop));
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
