import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryAgentHostStore } from "../src/store";
import { SqliteAgentHostStore, migrateJsonStoreToSqlite } from "../src/sqlite-store";

const directories: string[] = [];
const stores: SqliteAgentHostStore[] = [];
const time = "2026-10-26T00:00:00.000Z";
function paths() {
  const directory = mkdtempSync(join(tmpdir(), "typedance-sqlite-")); directories.push(directory);
  return { json: join(directory, "store.json"), sqlite: join(directory, "store.sqlite") };
}
function open(path: string) { const store = new SqliteAgentHostStore(path); stores.push(store); return store; }
function populate(store: MemoryAgentHostStore) {
  const conversation = store.createConversation({ workspaceId: "w", timestamp: time });
  const message = store.appendMessage({ message: { id: "m", conversation_id: conversation.id, role: "user", content: "保存内容", created_at: time } });
  const run = store.createRun({ run: { conversation_id: conversation.id, status: "running", mutation_mode: "review", started_at: time } });
  const event = store.appendRunEvent({ runId: run.id, type: "thinking_delta", payload: { delta: "思考" }, timestamp: time });
  return { conversation, message, run, event };
}
afterEach(() => {
  stores.splice(0).forEach((store) => store.close());
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe("SQLite Agent Host store", () => {
  it("persists incremental writes and resumes IDs and event sequences after reopening", () => {
    const { sqlite } = paths(); const store = open(sqlite);
    const { conversation, run } = populate(store);
    store.updateConversation(conversation.id, { name: "新标题", pinned: true });
    store.updateMessage("m", { content: "完整内容" });
    store.updateRun(run.id, { status: "completed", completed_at: time });
    const snapshot = store.snapshot(); store.close();
    const restored = open(sqlite);
    expect(restored.snapshot()).toEqual(snapshot);
    expect(restored.createConversation({ workspaceId: "w", timestamp: time }).id).toBe("conv_2");
    expect(restored.appendRunEvent({ runId: run.id, type: "assistant_delta", timestamp: time }).sequence).toBe(1);
    expect(restored.listRunEvents(run.id)).toHaveLength(2);
  });

  it("deletes the entire conversation atomically without touching another conversation", () => {
    const { sqlite } = paths(); const store = open(sqlite);
    const { conversation } = populate(store);
    const other = store.createConversation({ workspaceId: "w", timestamp: time });
    expect(store.deleteConversation(conversation.id)).toBe(true);
    expect(store.deleteConversation(conversation.id)).toBe(false);
    store.close();
    expect(open(sqlite).snapshot()).toMatchObject({ conversations: [other], messages: [], runs: [], events: [] });
  });

  it("does not publish in-memory changes when persistence fails", () => {
    const { sqlite } = paths(); const store = open(sqlite); populate(store);
    const snapshot = store.snapshot(); store.close();
    expect(() => store.updateMessage("m", { content: "未保存" })).toThrow();
    expect(store.snapshot()).toEqual(snapshot);
  });

  it("migrates JSON once, preserves the source, and never reimports a stale snapshot", () => {
    const { json, sqlite } = paths(); const memory = new MemoryAgentHostStore(); populate(memory);
    const original = JSON.stringify(memory.snapshot()); writeFileSync(json, original);
    migrateJsonStoreToSqlite(json, sqlite);
    const store = open(sqlite); expect(store.snapshot()).toEqual(memory.snapshot());
    store.updateMessage("m", { content: "迁移后修改" }); store.close();
    migrateJsonStoreToSqlite(json, sqlite);
    expect(open(sqlite).getMessage("m")?.content).toBe("迁移后修改");
    expect(readFileSync(json, "utf8")).toBe(original);
  });

  it("rolls back a failed migration and can retry after the source is repaired", () => {
    const { json, sqlite } = paths(); const memory = new MemoryAgentHostStore(); populate(memory);
    const snapshot = memory.snapshot();
    writeFileSync(json, JSON.stringify({ ...snapshot, events: [...snapshot.events, snapshot.events[0]] }));
    expect(() => migrateJsonStoreToSqlite(json, sqlite)).toThrow();
    const empty = open(sqlite); expect(empty.snapshot()).toEqual({ conversations: [], messages: [], runs: [], events: [] }); empty.close();
    writeFileSync(json, JSON.stringify(snapshot)); migrateJsonStoreToSqlite(json, sqlite);
    expect(open(sqlite).snapshot()).toEqual(snapshot);
  });

  it("refuses to overwrite a populated database with another JSON history", () => {
    const { json, sqlite } = paths(); const memory = new MemoryAgentHostStore(); populate(memory);
    writeFileSync(json, JSON.stringify(memory.snapshot()));
    const store = open(sqlite); const existing = store.createConversation({ workspaceId: "existing", timestamp: time }); store.close();
    expect(() => migrateJsonStoreToSqlite(json, sqlite)).toThrow("already contains data");
    expect(open(sqlite).snapshot().conversations).toEqual([existing]);
  });

  it("never rewrites old event rows while streaming a new delta", () => {
    const { sqlite } = paths(); const store = open(sqlite); const { run } = populate(store);
    const database = new DatabaseSync(sqlite);
    try {
      database.exec("CREATE TRIGGER immutable_events BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'old events must remain unchanged'); END;");
      store.appendRunEvent({ runId: run.id, type: "assistant_delta", payload: { delta: "new" }, timestamp: time });
      expect(database.prepare("SELECT count(*) AS count FROM events").get()!.count).toBe(2);
    } finally { database.close(); }
  });
});
