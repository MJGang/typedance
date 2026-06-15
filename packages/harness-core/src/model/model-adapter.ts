import type { HarnessToolCall } from "@typedance/harness-contracts";
import type { HarnessResolvedCapabilityPolicy } from "../plugin/plugin-registry";
import type { HarnessAgentSkillContext } from "../skill/skill-registry";

export type HarnessModelMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
};

export type HarnessModelRequest = {
  runId: string;
  capabilityPolicy: HarnessResolvedCapabilityPolicy;
  agentId: string;
  messages: HarnessModelMessage[];
  skillContext: HarnessAgentSkillContext;
  availableToolNames: string[];
  context: Record<string, unknown>;
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
    };

export type HarnessModelAdapter = {
  stream(request: HarnessModelRequest): AsyncIterable<HarnessModelStreamEvent>;
};
