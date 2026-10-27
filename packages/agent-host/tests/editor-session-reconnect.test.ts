import { describe, expect, it } from "vitest";
import type { EditorRequest, EditorSnapshot, EditorTransaction } from "@typedance/contracts";
import { EditorSession } from "../src/editor-session";

const snapshot: EditorSnapshot = { document_id: "doc", editor_session_id: "old", content_revision: 5, canvas_version: 1,
  doc_json: { type: "doc", content: [] }, plain_text: "" };
const transaction: EditorTransaction = { id: "tx", document_id: "doc", editor_session_id: "old", content_revision: 5,
  before_doc_json: snapshot.doc_json, doc_json: snapshot.doc_json, catalog_revision: "current", summary: "test", effects: [], node_origins: [], text_origins: [] };

function setup() {
  const requests: EditorRequest[] = [];
  const session = new EditorSession({ snapshot, mode: "review", signal: new AbortController().signal,
    emit: (type, payload) => { if (type === "editor_request") requests.push(payload.request as EditorRequest); } });
  return { session, requests };
}

describe("editor session reconnect", () => {
  it("reattaches a fresh read of the same document and invalidates pending old transactions", async () => {
    const { session, requests } = setup();
    const pendingWrite = session.apply(transaction);
    const pendingRead = session.refresh();
    const next = { ...snapshot, editor_session_id: "new", content_revision: 0 };
    session.respond(requests[1].id, { status: "snapshot", snapshot: next });
    await expect(pendingRead).resolves.toEqual(next);
    await expect(pendingWrite).resolves.toMatchObject({ status: "failed" });
    expect(() => session.respond(requests[0].id, { status: "applied", snapshot })).toThrow("已结束");
    await expect(session.apply(transaction)).rejects.toThrow("重新读取");
    expect(session.snapshot).toEqual(next);
    const audit = session.auditCompletion();
    session.respond(requests.at(-1)!.id, { status: "snapshot", snapshot: next });
    await expect(audit).resolves.toMatchObject({ decisions: [{ status: "failed" }] });
  });

  it("does not accept a different document or rebind a write response", async () => {
    const { session, requests } = setup();
    const reading = session.refresh();
    expect(() => session.respond(requests[0].id, { status: "snapshot", snapshot: { ...snapshot, document_id: "other" } })).toThrow("授权文档");
    session.respond(requests[0].id, { status: "snapshot", snapshot });
    await reading;
    const writing = session.apply(transaction);
    session.beginExecution(requests[1].id);
    expect(() => session.respond(requests[1].id, { status: "applied", snapshot: { ...snapshot, editor_session_id: "new" } })).toThrow("授权文档");
    session.respond(requests[1].id, { status: "rejected" });
    await writing;
  });
});
