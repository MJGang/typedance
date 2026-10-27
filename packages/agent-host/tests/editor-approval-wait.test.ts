import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorRequest, EditorSnapshot, EditorTransaction } from "@typedance/contracts";
import { EditorSession } from "../src/editor-session";

const snapshot: EditorSnapshot = { document_id: "doc", editor_session_id: "editor", content_revision: 2, canvas_version: 1,
  doc_json: { type: "doc", content: [{ type: "paragraph" }] }, plain_text: "" };
const transaction: EditorTransaction = { id: "tx", document_id: "doc", editor_session_id: "editor", content_revision: 2,
  before_doc_json: snapshot.doc_json, doc_json: snapshot.doc_json, catalog_revision: "catalog", summary: "待确认修改", effects: [], node_origins: [], text_origins: [] };
function setup(mode: "review" | "solo" = "review") {
  const controller = new AbortController();
  const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const session = new EditorSession({ snapshot, mode, signal: controller.signal, emit: (type, payload) => events.push({ type, payload }) });
  const latest = () => (events.findLast((event) => event.type === "editor_request")!.payload.request as EditorRequest).id;
  return { session, controller, events, latest };
}
afterEach(() => vi.useRealTimers());

describe("manual editor approval waiting", () => {
  it("keeps one proposal open for days without execution, then accepts the user's explicit decision", async () => {
    vi.useFakeTimers();
    const { session, events, latest } = setup();
    const result = session.apply(transaction);
    const id = latest();
    await vi.advanceTimersByTimeAsync(3 * 24 * 60 * 60_000);
    expect(session.pending(id).transaction).toEqual(transaction);
    expect(events.map((event) => event.type)).toEqual(["editor_request"]);
    expect(() => session.respond(id, { status: "applied", snapshot, persisted: true })).toThrow("先确认");
    session.beginExecution(id);
    session.respond(id, { status: "applied", snapshot, persisted: true });
    await expect(result).resolves.toMatchObject({ status: "applied", persisted: true });
    expect(events.map((event) => event.type)).toEqual(["editor_request", "editor_execution_started", "editor_response"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("starts a bounded execution timeout only after approval and does not extend it on duplicate begin calls", async () => {
    vi.useFakeTimers();
    const { session, events, latest } = setup();
    const result = session.apply(transaction).catch((error: Error) => error.message);
    const id = latest();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
    session.beginExecution(id);
    await vi.advanceTimersByTimeAsync(299_999);
    session.beginExecution(id);
    expect(events.filter((event) => event.type === "editor_execution_started")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toContain("修改可能已生效");
    expect(() => session.pending(id)).toThrow("已结束");
    expect(() => session.beginExecution(id)).toThrow("已结束");
  });

  it.each(["snapshot", "solo"] as const)("keeps the timeout for actual %s operations", async (kind) => {
    vi.useFakeTimers();
    const { session, latest } = setup(kind === "solo" ? "solo" : "review");
    const result = (kind === "snapshot" ? session.refresh() : session.apply(transaction)).catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(await result).toContain(kind === "snapshot" ? "读取编辑器超时" : "编辑执行结果回传超时");
    expect(() => session.pending(latest())).toThrow("已结束");
  });

  it("can reject or cancel an old manual proposal without starting execution", async () => {
    vi.useFakeTimers();
    const first = setup();
    const rejected = first.session.apply(transaction);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
    first.session.respond(first.latest(), { status: "rejected" });
    await expect(rejected).resolves.toEqual({ status: "rejected" });
    const second = setup();
    const canceled = second.session.apply(transaction).catch((error: Error) => error.message);
    second.controller.abort();
    expect(await canceled).toBe("编辑请求已取消");
    expect(() => second.session.beginExecution(second.latest())).toThrow("已结束");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("supersedes only unapproved proposals, leaving already approved execution intact", async () => {
    vi.useFakeTimers();
    const { session, latest } = setup();
    const first = session.apply(transaction);
    session.supersedeApproval();
    await expect(first).resolves.toMatchObject({ status: "failed", error: expect.stringContaining("最新输入") });
    const next = session.apply(transaction);
    const id = latest();
    session.beginExecution(id);
    session.supersedeApproval();
    expect(session.pending(id)).toBeDefined();
    session.respond(id, { status: "applied", snapshot, persisted: true });
    await expect(next).resolves.toMatchObject({ status: "applied" });
  });
});
