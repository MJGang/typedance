import type { HarnessToolCall, HarnessToolOrigin } from "@typedance/harness-contracts";
import type { HarnessResolvedCapabilityPolicy } from "../plugin/plugin-registry";

export type HarnessModelMessage =
  | {
      role: "system" | "user";
      content: string;
    }
  | {
      role: "assistant";
      content: string;
      toolCalls?: HarnessToolCall[];
    }
  | {
      role: "tool";
      content: string;
      toolCallId: string;
      toolName: string;
    };

export type HarnessPromptSectionSlot = "developer" | "contextual";

export type HarnessPromptSection = {
  slot: HarnessPromptSectionSlot;
  source: string;
  content: string;
  priority?: number;
  budget?: {
    maxChars: number;
    originalChars: number;
    truncated: boolean;
  };
  provenance?: {
    kind: string;
    sourceId?: string;
    path?: string;
    metadata?: Record<string, string>;
  };
};

export type HarnessPromptBundle = {
  developer: HarnessPromptSection[];
  contextual: HarnessPromptSection[];
  conversation: HarnessModelMessage[];
};

export type HarnessModelRequest = {
  signal: AbortSignal;
  runId: string;
  capabilityPolicy: HarnessResolvedCapabilityPolicy;
  agentId: string;
  model?: string;
  prompt: HarnessPromptBundle;
  availableToolNames: string[];
  availableTools: HarnessModelTool[];
};

export type HarnessModelTool = {
  name: string;
  origin: HarnessToolOrigin;
  description: string;
  inputSchema?: Record<string, unknown>;
};

export type HarnessModelStreamEvent =
  | {
      type: "assistant_delta";
      messageId: string;
      delta: string;
    }
  | {
      type: "reasoning_summary_delta";
      summaryId: string;
      delta: string;
    }
  | {
      type: "tool_call";
      call: HarnessToolCall;
    }
  | {
      type: "final";
      output: Record<string, unknown>;
      usage?: HarnessModelUsage;
    };

export type HarnessModelUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadInputTokens?: number;
  cacheMissInputTokens?: number;
  reasoningOutputTokens?: number;
};

export type HarnessModelAdapter = {
  stream(request: HarnessModelRequest): AsyncIterable<HarnessModelStreamEvent>;
};
