import { renameSync } from "node:fs";
import {
  agentConversationSchema,
  agentMessageSchema,
  agentRunEventSchema,
  agentRunSchema,
  type AgentConversation,
  type AgentMessage,
  type AgentRun,
  type AgentRunEvent,
} from "@typedance/contracts";

export type AgentHostStoreSnapshot = {
  conversations: AgentConversation[];
  messages: AgentMessage[];
  runs: AgentRun[];
  events: AgentRunEvent[];
};

export type CreateConversationInput = {
  workspaceId: string;
  name?: string | null;
  timestamp: string;
};

export type AppendMessageInput = {
  message: AgentMessage;
};

export type CreateRunInput = {
  run: Omit<AgentRun, "id"> & { id?: string };
};

export type AppendRunEventInput = {
  runId: string;
  type: AgentRunEvent["type"];
  payload?: Record<string, unknown>;
  timestamp: string;
};

export type AgentHostStore = {
  close(): void;
  snapshot(): AgentHostStoreSnapshot;
  listConversations(workspaceId: string): AgentConversation[];
  getConversation(conversationId: string): AgentConversation | undefined;
  createConversation(input: CreateConversationInput): AgentConversation;
  updateConversation(conversationId: string, patch: Partial<Pick<AgentConversation, "name" | "preview" | "first_user_message" | "pinned" | "status" | "last_message_at" | "updated_at">>): AgentConversation;
  deleteConversation(conversationId: string): boolean;
  listMessages(conversationId: string): AgentMessage[];
  getMessage(messageId: string): AgentMessage | undefined;
  appendMessage(input: AppendMessageInput): AgentMessage;
  updateMessage(messageId: string, patch: Partial<Pick<AgentMessage, "content" | "run_id">>): AgentMessage;
  createRun(input: CreateRunInput): AgentRun;
  getRun(runId: string): AgentRun | undefined;
  listRuns(conversationId?: string): AgentRun[];
  updateRun(runId: string, patch: Partial<Pick<AgentRun, "status" | "completed_at" | "duration_ms">>): AgentRun;
  listRunEvents(runId: string, afterSequence?: number): AgentRunEvent[];
  appendRunEvent(input: AppendRunEventInput): AgentRunEvent;
};

export type AgentHostStoreChange =
  | { kind: "conversation"; value: AgentConversation }
  | { kind: "message"; value: AgentMessage }
  | { kind: "run"; value: AgentRun }
  | { kind: "event"; value: AgentRunEvent }
  | { kind: "delete_conversation"; conversationId: string; runIds: string[] };

type MutableSnapshot = {
  conversations: AgentConversation[];
  messages: AgentMessage[];
  runs: AgentRun[];
  events: AgentRunEvent[];
  nextConversationId: number;
  nextMessageId: number;
  nextRunId: number;
  nextEventId: number;
};

export class MemoryAgentHostStore implements AgentHostStore {
  protected data: MutableSnapshot;
  #eventsByRun = new Map<string, AgentRunEvent[]>();

  constructor(snapshot?: Partial<AgentHostStoreSnapshot>) {
    this.data = {
      conversations: [...(snapshot?.conversations ?? [])],
      messages: [...(snapshot?.messages ?? [])],
      runs: [...(snapshot?.runs ?? [])],
      events: [...(snapshot?.events ?? [])],
      nextConversationId: nextNumericId(snapshot?.conversations?.map((item) => item.id) ?? [], "conv_"),
      nextMessageId: nextNumericId(snapshot?.messages?.map((item) => item.id) ?? [], "msg_"),
      nextRunId: nextNumericId(snapshot?.runs?.map((item) => item.id) ?? [], "arun_"),
      nextEventId: nextNumericId(snapshot?.events?.map((item) => item.id) ?? [], "aevt_"),
    };
    for (const event of this.data.events) {
      const events = this.#eventsByRun.get(event.run_id) ?? [];
      events.push(event); this.#eventsByRun.set(event.run_id, events);
    }
    for (const events of this.#eventsByRun.values()) events.sort((left, right) => left.sequence - right.sequence);
  }

  close(): void { /* No resources are held by the memory store. */ }

  listConversations(workspaceId: string): AgentConversation[] {
    return this.data.conversations
      .filter((conversation) => conversation.workspace_id === workspaceId)
      .sort((left, right) => {
        if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
        return timestampValue(right.last_message_at ?? right.updated_at) - timestampValue(left.last_message_at ?? left.updated_at);
      });
  }

  getConversation(conversationId: string): AgentConversation | undefined {
    return this.data.conversations.find((conversation) => conversation.id === conversationId);
  }

  createConversation(input: CreateConversationInput): AgentConversation {
    const conversation = agentConversationSchema.parse({
      id: `conv_${this.data.nextConversationId++}`,
      workspace_id: input.workspaceId,
      name: normalizeConversationName(input.name),
      preview: "",
      pinned: false,
      status: "idle",
      created_at: input.timestamp,
      updated_at: input.timestamp,
    });
    this.persist({ kind: "conversation", value: conversation });
    this.data.conversations.push(conversation);
    return conversation;
  }

  updateConversation(
    conversationId: string,
    patch: Partial<Pick<AgentConversation, "name" | "preview" | "first_user_message" | "pinned" | "status" | "last_message_at" | "updated_at">>
  ): AgentConversation {
    const index = this.data.conversations.findIndex((conversation) => conversation.id === conversationId);
    if (index < 0) throw new Error(`Unknown conversation: ${conversationId}`);
    const updated = agentConversationSchema.parse({
      ...this.data.conversations[index],
      ...patch,
      ...(patch.name !== undefined ? { name: normalizeConversationName(patch.name) } : {}),
    });
    this.persist({ kind: "conversation", value: updated });
    this.data.conversations[index] = updated;
    return updated;
  }

  deleteConversation(conversationId: string): boolean {
    const before = this.data.conversations.length;
    const messageIds = new Set(
      this.data.messages
        .filter((message) => message.conversation_id === conversationId)
        .map((message) => message.id)
    );
    const runIds = new Set(
      this.data.runs
        .filter((run) => run.conversation_id === conversationId || (run.assistant_message_id && messageIds.has(run.assistant_message_id)))
        .map((run) => run.id)
    );
    if (!this.data.conversations.some((conversation) => conversation.id === conversationId)) return false;
    this.persist({ kind: "delete_conversation", conversationId, runIds: [...runIds] });
    this.data.conversations = this.data.conversations.filter((conversation) => conversation.id !== conversationId);
    this.data.messages = this.data.messages.filter((message) => message.conversation_id !== conversationId);
    this.data.runs = this.data.runs.filter((run) => !runIds.has(run.id));
    this.data.events = this.data.events.filter((event) => !runIds.has(event.run_id));
    const deleted = this.data.conversations.length !== before;
    for (const runId of runIds) this.#eventsByRun.delete(runId);
    return deleted;
  }

  listMessages(conversationId: string): AgentMessage[] {
    return this.data.messages
      .filter((message) => message.conversation_id === conversationId)
      .sort((left, right) => timestampValue(left.created_at) - timestampValue(right.created_at));
  }

  getMessage(messageId: string): AgentMessage | undefined {
    return this.data.messages.find((message) => message.id === messageId);
  }

  appendMessage(input: AppendMessageInput): AgentMessage {
    const message = agentMessageSchema.parse({
      ...input.message,
      id: input.message.id || `msg_${this.data.nextMessageId++}`,
    });
    this.persist({ kind: "message", value: message });
    this.data.messages.push(message);
    return message;
  }

  updateMessage(messageId: string, patch: Partial<Pick<AgentMessage, "content" | "run_id">>): AgentMessage {
    const index = this.data.messages.findIndex((message) => message.id === messageId);
    if (index < 0) throw new Error(`Unknown message: ${messageId}`);
    const updated = agentMessageSchema.parse({
      ...this.data.messages[index],
      ...patch,
    });
    this.persist({ kind: "message", value: updated });
    this.data.messages[index] = updated;
    return updated;
  }

  createRun(input: CreateRunInput): AgentRun {
    const id = input.run.id || `arun_${this.data.nextRunId++}`;
    if (this.data.runs.some((run) => run.id === id)) {
      throw new Error(`Duplicate agent run: ${id}`);
    }
    const run = agentRunSchema.parse({
      ...input.run,
      id,
    });
    this.persist({ kind: "run", value: run });
    this.data.runs.push(run);
    return run;
  }

  getRun(runId: string): AgentRun | undefined {
    return this.data.runs.find((run) => run.id === runId);
  }

  listRuns(conversationId?: string): AgentRun[] {
    return this.data.runs
      .filter((run) => conversationId === undefined || run.conversation_id === conversationId)
      .sort((left, right) => timestampValue(left.started_at) - timestampValue(right.started_at));
  }

  updateRun(runId: string, patch: Partial<Pick<AgentRun, "status" | "completed_at" | "duration_ms">>): AgentRun {
    const index = this.data.runs.findIndex((run) => run.id === runId);
    if (index < 0) throw new Error(`Unknown agent run: ${runId}`);
    const updated = agentRunSchema.parse({
      ...this.data.runs[index],
      ...patch,
    });
    this.persist({ kind: "run", value: updated });
    this.data.runs[index] = updated;
    return updated;
  }

  listRunEvents(runId: string, afterSequence = -1): AgentRunEvent[] {
    return (this.#eventsByRun.get(runId) ?? [])
      .filter((event) => event.sequence > afterSequence)
      .sort((left, right) => left.sequence - right.sequence);
  }

  appendRunEvent(input: AppendRunEventInput): AgentRunEvent {
    const event = agentRunEventSchema.parse({
      id: `aevt_${this.data.nextEventId++}`,
      run_id: input.runId,
      sequence: this.nextRunEventSequence(input.runId),
      type: input.type,
      payload: input.payload ?? {},
      created_at: input.timestamp,
    });
    this.persist({ kind: "event", value: event });
    this.data.events.push(event);
    const events = this.#eventsByRun.get(input.runId) ?? [];
    events.push(event); this.#eventsByRun.set(input.runId, events);
    return event;
  }

  protected nextRunEventSequence(runId: string): number {
    const events = this.#eventsByRun.get(runId);
    return events?.length ? Math.max(events.at(-1)!.sequence + 1, events.length) : 0;
  }

  protected persist(_change: AgentHostStoreChange): void {
    // Memory store intentionally does not persist.
  }

  snapshot(): AgentHostStoreSnapshot {
    return {
      conversations: [...this.data.conversations],
      messages: [...this.data.messages],
      runs: [...this.data.runs],
      events: [...this.data.events],
    };
  }
}

export function createMemoryAgentHostStore(snapshot?: Partial<AgentHostStoreSnapshot>): AgentHostStore {
  return new MemoryAgentHostStore(snapshot);
}

function nextNumericId(ids: string[], prefix: string): number {
  let maximum = -Infinity;
  for (const id of ids) {
    if (!id.startsWith(prefix)) continue;
    const value = Number(id.slice(prefix.length));
    if (Number.isFinite(value)) maximum = Math.max(maximum, value);
  }
  return maximum === -Infinity ? 1 : maximum + 1;
}

function timestampValue(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizeConversationName(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  return trimmed ? trimmed : null;
}

export function renameWithWindowsRetry(from: string, to: string): void {
  const retryDelaysMs = [5, 10, 20, 40, 80, 120, 160, 240, 320, 500];
  for (let attempt = 0; ; attempt += 1) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      if (!isRetryableFileReplaceError(error) || attempt >= retryDelaysMs.length) {
        throw error;
      }
      sleepSync(retryDelaysMs[attempt] ?? 500);
    }
  }
}

function isRetryableFileReplaceError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return error.code === "EPERM" || error.code === "EBUSY" || error.code === "EACCES";
}

function sleepSync(ms: number): void {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, ms);
}
