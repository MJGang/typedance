import type { HarnessToolCall, HarnessToolOrigin } from "@typedance/harness-contracts";
import type { HarnessModelContent } from "@typedance/harness-contracts";
export type { HarnessContentPart, HarnessModelContent } from "@typedance/harness-contracts";
import type { HarnessResolvedCapabilityPolicy } from "../plugin/plugin-registry";

export type { HarnessModelMessage, HarnessPromptSection, HarnessPromptBundle } from "@typedance/harness-contracts";
import type { HarnessPromptBundle } from "@typedance/harness-contracts";
export type HarnessPromptSectionSlot = "developer" | "contextual";

export type HarnessModelRequest = {
  signal: AbortSignal;
  runId: string;
  capabilityPolicy: HarnessResolvedCapabilityPolicy;
  agentId: string;
  model?: string;
  modelOptions?: Record<string, unknown>;
  prompt: HarnessPromptBundle;
  availableToolNames: string[];
  availableTools: HarnessModelTool[];
  purpose?: "response" | "compaction";
  maxOutputTokens?: number;
};

export type HarnessModelTool = {
  name: string;
  origin: HarnessToolOrigin;
  description: string;
  inputSchema?: Record<string, unknown>;
};

export type HarnessModelStreamEvent =
  | { type: "first_token" }
  | { type: "tool_call_delta"; callId: string; delta: string }
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
      incomplete?: boolean;
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
