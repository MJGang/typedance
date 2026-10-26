import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { agentConversationSchema, agentMessageSchema, agentRunSchema, agentRunEventSchema } from "@typedance/contracts";
import { MemoryAgentHostStore, type AgentHostStoreChange, type AgentHostStoreSnapshot } from "./store";

const snapshotSchema = z.object({ conversations: agentConversationSchema.array(), messages: agentMessageSchema.array(), runs: agentRunSchema.array(), events: agentRunEventSchema.array() });

function openDatabase(filePath: string): DatabaseSync {
  mkdirSync(dirname(filePath), { recursive: true });
  const database = new DatabaseSync(filePath);
  try {
    const version = database.prepare("PRAGMA user_version").get()!.user_version;
    if (version !== 0 && version !== 1) throw new Error(`Unsupported Agent Host database version: ${version}`);
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, data TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE, data TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE, data TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, sequence INTEGER NOT NULL, data TEXT NOT NULL, UNIQUE(run_id, sequence)) STRICT;
      CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS runs_conversation ON runs(conversation_id);
      PRAGMA user_version = 1;
    `);
    return database;
  } catch (error) { database.close(); throw error; }
}

function statements(database: DatabaseSync) {
  return {
    conversation: database.prepare("INSERT INTO conversations(id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data"),
    message: database.prepare("INSERT INTO messages(id, conversation_id, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET conversation_id=excluded.conversation_id, data=excluded.data"),
    run: database.prepare("INSERT INTO runs(id, conversation_id, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET conversation_id=excluded.conversation_id, data=excluded.data"),
    event: database.prepare("INSERT INTO events(id, run_id, sequence, data) VALUES (?, ?, ?, ?)"),
    deleteRun: database.prepare("DELETE FROM runs WHERE id=?"),
    deleteConversation: database.prepare("DELETE FROM conversations WHERE id=?"),
  };
}

function writeChange(database: DatabaseSync, prepared: ReturnType<typeof statements>, change: AgentHostStoreChange): void {
  switch (change.kind) {
    case "conversation": prepared.conversation.run(change.value.id, JSON.stringify(change.value)); return;
    case "message": prepared.message.run(change.value.id, change.value.conversation_id ?? null, JSON.stringify(change.value)); return;
    case "run": prepared.run.run(change.value.id, change.value.conversation_id ?? null, JSON.stringify(change.value)); return;
    case "event": prepared.event.run(change.value.id, change.value.run_id, change.value.sequence, JSON.stringify(change.value)); return;
    case "delete_conversation":
      database.exec("BEGIN IMMEDIATE");
      try {
        for (const runId of change.runIds) prepared.deleteRun.run(runId);
        prepared.deleteConversation.run(change.conversationId);
        database.exec("COMMIT");
      } catch (error) { database.exec("ROLLBACK"); throw error; }
  }
}

function loadSnapshot(database: DatabaseSync): AgentHostStoreSnapshot {
  const read = (table: string) => database.prepare(`SELECT data FROM ${table} ORDER BY rowid`).all().map((row) => JSON.parse(row.data as string));
  return snapshotSchema.parse({ conversations: read("conversations"), messages: read("messages"), runs: read("runs"), events: read("events") });
}

/** 每次只写变更记录；流式输出不会重新编码、覆盖整个历史文件。 */
export class SqliteAgentHostStore extends MemoryAgentHostStore {
  #database: DatabaseSync;
  #prepared: ReturnType<typeof statements>;
  #closed = false;

  constructor(filePath: string) {
    const database = openDatabase(filePath);
    let snapshot: AgentHostStoreSnapshot;
    try { snapshot = loadSnapshot(database); }
    catch (error) { database.close(); throw error; }
    super(snapshot);
    this.#database = database;
    this.#prepared = statements(database);
  }

  protected override persist(change: AgentHostStoreChange): void { writeChange(this.#database, this.#prepared, change); }
  override close(): void { if (!this.#closed) { this.#database.close(); this.#closed = true; } }
}

export function createSqliteAgentHostStore(filePath: string): SqliteAgentHostStore { return new SqliteAgentHostStore(filePath); }

/** 原 JSON 只在这次事务迁移中读取；成功后只使用 SQLite，原文件保留为备份。 */
export function migrateJsonStoreToSqlite(jsonFile: string, databaseFile: string): void {
  const database = openDatabase(databaseFile);
  try {
    database.exec("BEGIN IMMEDIATE");
    try {
      if (!database.prepare("SELECT value FROM metadata WHERE key='json_imported'").get()) {
        if (existsSync(jsonFile)) {
          const count = database.prepare("SELECT (SELECT count(*) FROM conversations) + (SELECT count(*) FROM messages) + (SELECT count(*) FROM runs) + (SELECT count(*) FROM events) AS count").get()!.count;
          if (count !== 0) throw new Error("Agent Host database already contains data; JSON import was refused to preserve both histories");
          const snapshot = snapshotSchema.parse(JSON.parse(readFileSync(jsonFile, "utf8")));
          const prepared = statements(database);
          for (const value of snapshot.conversations) writeChange(database, prepared, { kind: "conversation", value });
          for (const value of snapshot.messages) writeChange(database, prepared, { kind: "message", value });
          for (const value of snapshot.runs) writeChange(database, prepared, { kind: "run", value });
          for (const value of snapshot.events) writeChange(database, prepared, { kind: "event", value });
        }
        database.prepare("INSERT INTO metadata(key, value) VALUES ('json_imported', '1')").run();
      }
      database.exec("COMMIT");
    } catch (error) { database.exec("ROLLBACK"); throw error; }
  } finally { database.close(); }
}
