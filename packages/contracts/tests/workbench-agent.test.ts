import { describe, expect, it } from "vitest";
import {
  agentConversationSchema,
  agentMessageSchema,
  agentRunEventSchema,
  agentRunSchema,
  canvasMutationModeSchema,
  contextSourceChildSchema,
  contextSourceSchema,
} from "../src";

const now = "2026-06-16T00:00:00.000Z";

describe("workbench agent contracts", () => {
  it("validates readonly context sources for local files, directories, and webpages", () => {
    expect(contextSourceSchema.parse({
      id: "ctx_1",
      workspace_id: "doc_1",
      type: "file",
      title: "resume.pdf",
      uri: "file:///E:/resume/resume.pdf",
      created_at: now,
      updated_at: now,
    }).metadata).toEqual({});

    expect(contextSourceSchema.parse({
      id: "ctx_2",
      workspace_id: "doc_1",
      type: "webpage",
      title: "Frontend JD",
      uri: "https://example.com/jobs/frontend",
      description: "Hiring frontend engineers.",
      summary: "A frontend job description.",
      favicon_url: "https://example.com/favicon.ico",
      created_at: now,
      updated_at: now,
    }).type).toBe("webpage");
  });

  it("models lazy directory children without embedding AI concepts", () => {
    expect(contextSourceChildSchema.parse({
      type: "directory",
      name: "typedance",
      path: "typedance",
      uri: "file:///E:/workspaces/typedance",
      updated_at: now,
    })).toMatchObject({
      type: "directory",
      path: "typedance",
    });
  });

  it("validates conversations, messages, runs, and persisted events", () => {
    const conversation = agentConversationSchema.parse({
      id: "conv_1",
      workspace_id: "doc_1",
      title: "新对话",
      pinned: false,
      status: "running",
      created_at: now,
      updated_at: now,
    });

    const message = agentMessageSchema.parse({
      id: "msg_1",
      conversation_id: conversation.id,
      role: "user",
      content: "参考 @Frontend JD 优化专业技能",
      mentions: [{
        context_source_id: "ctx_1",
        type: "webpage",
        label: "Frontend JD",
        uri: "https://example.com/jobs/frontend",
      }],
      created_at: now,
    });

    const run = agentRunSchema.parse({
      id: "run_1",
      conversation_id: conversation.id,
      assistant_message_id: "msg_2",
      status: "running",
      model: "gpt-5",
      mutation_mode: "review",
      started_at: now,
    });

    expect(message.mentions[0]?.label).toBe("Frontend JD");
    expect(run.mutation_mode).toBe("review");
    expect(canvasMutationModeSchema.parse("solo")).toBe("solo");

    expect(agentRunEventSchema.parse({
      id: "evt_1",
      run_id: run.id,
      sequence: 0,
      type: "thinking_delta",
      payload: { delta: "Analyzing the resume." },
      created_at: now,
    }).type).toBe("thinking_delta");
  });
});
