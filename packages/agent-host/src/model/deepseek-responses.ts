import { HarnessModelError, type HarnessModelStreamEvent, type HarnessModelUsage } from "@typedance/harness-core";
import type { DeepSeekContent, DeepSeekMessage } from "./deepseek";

type ResponsesContent = string | Array<
  { type: "input_text"; text: string } | { type: "input_image"; image_url: string; detail?: string }
>;

type ResponsesInputItem =
  | { type: "message"; role: "system" | "user" | "assistant"; content: ResponsesContent }
  | { type: "reasoning"; content: Array<{ type: "reasoning_text"; text: string }> }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: ResponsesContent };

function toResponsesContent(content: DeepSeekContent): ResponsesContent {
  if (typeof content === "string") return content;
  return content.map((part) => part.type === "text" ? { type: "input_text", text: part.text } : {
    type: "input_image", image_url: part.image_url.url, ...(part.image_url.detail ? { detail: part.image_url.detail } : {}),
  });
}

export function buildDeepSeekResponsesInput(messages: DeepSeekMessage[]): ResponsesInputItem[] {
  return messages.flatMap((message): ResponsesInputItem[] => {
    if (message.role === "tool") {
      return [{ type: "function_call_output", call_id: message.tool_call_id, output: toResponsesContent(message.content) }];
    }
    if (message.role !== "assistant") {
      return [{ type: "message", role: message.role, content: toResponsesContent(message.content) }];
    }

    // DeepSeek 的 Responses 端点无状态，工具续轮需要带回推理、调用和结果。
    const items: ResponsesInputItem[] = [];
    if (message.reasoning_content) {
      items.push({ type: "reasoning", content: [{ type: "reasoning_text", text: message.reasoning_content }] });
    }
    if (message.content !== null) items.push({ type: "message", role: "assistant", content: message.content });
    for (const call of message.tool_calls ?? []) {
      items.push({ type: "function_call", call_id: call.id, name: call.function.name, arguments: call.function.arguments });
    }
    return items;
  });
}

type ResponsesOutputItem = {
  type: string;
  id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  status?: string;
};

type ResponsesUsage = {
  input_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens?: number;
  output_tokens_details?: { reasoning_tokens?: number };
  total_tokens?: number;
};

type ResponsesError = { code?: string; message?: string };
type ResponsesEvent = {
  type: string;
  delta?: string;
  item_id?: string;
  item?: ResponsesOutputItem;
  response?: { output: ResponsesOutputItem[]; usage?: ResponsesUsage | null; error?: ResponsesError | null };
} & ResponsesError;

type ToolCall = Extract<HarnessModelStreamEvent, { type: "tool_call" }>["call"];

function mapUsage(usage: ResponsesUsage): HarnessModelUsage {
  const cached = usage.input_tokens_details?.cached_tokens;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.total_tokens,
    cacheReadInputTokens: cached,
    cacheMissInputTokens: cached !== undefined && usage.input_tokens !== undefined ? usage.input_tokens - cached : undefined,
    reasoningOutputTokens: usage.output_tokens_details?.reasoning_tokens,
  };
}

export async function* streamDeepSeekResponses(
  stream: AsyncIterable<string>,
  { model, runId, apiKey, resolveToolCall }: {
    model: string;
    runId: string;
    apiKey: string;
    resolveToolCall: (id: string, name: string, args: string) => ToolCall;
  },
): AsyncIterable<HarnessModelStreamEvent> {
  let firstToken = false;
  let emittedText = false;
  const callIds = new Map<string, string>();
  for await (const data of stream) {
    if (data === "[DONE]") break;
    const event = JSON.parse(data) as ResponsesEvent;
    let delta: HarnessModelStreamEvent | undefined;
    if (event.type === "response.output_text.delta" && event.delta) {
      emittedText = true;
      delta = { type: "assistant_delta", messageId: `${runId}:assistant`, delta: event.delta };
    } else if (event.type === "response.reasoning_text.delta" && event.delta) {
      delta = { type: "reasoning_summary_delta", summaryId: `${runId}:reasoning`, delta: event.delta };
    } else if (event.type === "response.output_item.added" && event.item?.type === "function_call") {
      const { id, call_id: callId, name } = event.item;
      if (id && callId) callIds.set(id, callId);
      if (callId && name) delta = { type: "tool_call_delta", callId, delta: name };
    } else if (event.type === "response.function_call_arguments.delta" && event.item_id && event.delta) {
      const callId = callIds.get(event.item_id);
      if (callId) delta = { type: "tool_call_delta", callId, delta: event.delta };
    }

    if (delta) {
      if (!firstToken) yield { type: "first_token" };
      firstToken = true;
      yield delta;
    }

    if (event.type === "response.failed" || event.type === "error") {
      const error = event.response?.error ?? event;
      const message = error.message?.replaceAll(apiKey, "[redacted]").slice(0, 500);
      throw new HarnessModelError(`DeepSeek responses failed${message ? `: ${message}` : ""}`,
        error.code === "server_error" || error.code === "rate_limit_exceeded");
    }
    if (event.type !== "response.completed" && event.type !== "response.incomplete") continue;
    if (!Array.isArray(event.response?.output)) throw new Error("DeepSeek Responses final event is missing output");

    // 只有正常完成的响应才交给 Harness 执行工具，使用终态中的完整参数和 call_id。
    if (event.type === "response.completed") {
      const calls = event.response.output.filter((item) => item.type === "function_call").map((item) => {
        if (!item.call_id || !item.name || typeof item.arguments !== "string" || item.status === "incomplete") {
          throw new Error("DeepSeek Responses returned an incomplete function call");
        }
        return resolveToolCall(item.call_id, item.name, item.arguments);
      });
      for (const call of calls) yield { type: "tool_call", call };
    }
    yield {
      type: "final",
      output: { model, empty: !emittedText },
      ...(event.response.usage ? { usage: mapUsage(event.response.usage) } : {}),
      ...(event.type === "response.incomplete" ? { incomplete: true } : {}),
    };
    return;
  }
  throw new HarnessModelError("DeepSeek Responses stream ended before its final event", true);
}
