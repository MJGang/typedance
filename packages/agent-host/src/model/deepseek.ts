import type {
  HarnessModelAdapter,
  HarnessModelMessage,
  HarnessModelRequest,
  HarnessModelStreamEvent,
} from "@typedance/harness-core";

export type DeepSeekModelAdapterOptions = {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  fetch?: typeof fetch;
  reasoningEffort?: "low" | "medium" | "high" | "max";
  thinking?: boolean;
};

type DeepSeekStreamDelta = {
  content?: string | null;
  reasoning_content?: string | null;
};

type DeepSeekStreamChunk = {
  choices?: Array<{
    delta?: DeepSeekStreamDelta;
    finish_reason?: string | null;
  }>;
};

const DEFAULT_BASE_URL = "https://api.deepseek.com";
export const DEFAULT_DEEPSEEK_FLASH_MODEL = "deepseek-v4-flash";

export function createDeepSeekModelAdapter(options: DeepSeekModelAdapterOptions): HarnessModelAdapter {
  const apiKey = options.apiKey.trim();
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is required");
  }

  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const defaultModel = options.defaultModel ?? DEFAULT_DEEPSEEK_FLASH_MODEL;
  assertFlashModel(defaultModel);

  return {
    async *stream(request: HarnessModelRequest): AsyncIterable<HarnessModelStreamEvent> {
      const model = resolveModelName(request, defaultModel);
      assertFlashModel(model);

      const response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: buildDeepSeekMessages(request),
          stream: true,
          ...(options.thinking === false ? {} : { thinking: { type: "enabled" } }),
          ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
        }),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`DeepSeek chat completion failed: ${response.status} ${text.slice(0, 500)}`.trim());
      }
      if (!response.body) {
        throw new Error("DeepSeek chat completion response did not include a stream body");
      }

      let emittedAssistantContent = false;
      for await (const chunk of parseDeepSeekSse(response.body)) {
        const delta = chunk.choices?.[0]?.delta;
        const reasoning = normalizeDelta(delta?.reasoning_content);
        if (reasoning) {
          yield {
            type: "reasoning_summary_delta",
            summaryId: `${request.runId}:reasoning`,
            delta: reasoning,
          };
        }

        const content = normalizeDelta(delta?.content);
        if (content) {
          emittedAssistantContent = true;
          yield {
            type: "assistant_delta",
            messageId: `${request.runId}:assistant`,
            delta: content,
          };
        }
      }

      yield {
        type: "final",
        output: {
          model,
          empty: !emittedAssistantContent,
        },
      };
    },
  };
}

export function assertFlashModel(model: string): void {
  if (/\bpro\b/i.test(model)) {
    throw new Error(`Refusing to use non-flash DeepSeek model: ${model}`);
  }
}

function resolveModelName(request: HarnessModelRequest, defaultModel: string): string {
  const requested = request.context.model;
  return typeof requested === "string" && requested.trim() ? requested.trim() : defaultModel;
}

function buildDeepSeekMessages(request: HarnessModelRequest): HarnessModelMessage[] {
  const suppliedSystemMessages = request.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content.trim())
    .filter(Boolean);
  const conversationMessages = request.messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
  const system = [
    "You are an AI agent running inside a desktop agent harness.",
    "Use the supplied runtime context and user-visible conversation history.",
    "When read-only context is supplied, treat it as evidence and cite it naturally in your answer.",
    "Interactive harness tools are not exposed through this DeepSeek adapter in this turn. Do not claim you called tools. Use only the context already supplied in this request.",
    "If the current active resume canvas content is unavailable, say that you cannot inspect the current document yet. Do not summarize, score, or rewrite a current document from document_id, title, or older conversation history alone.",
    "Do not claim that you modified local files unless the harness reports a completed tool or canvas patch event.",
    `Agent id: ${request.agentId}`,
    `Runtime context: ${safeJsonForPrompt(request.context, 12000)}`,
    suppliedSystemMessages.length > 0
      ? `Supplied runtime evidence:\n\n${suppliedSystemMessages.join("\n\n")}`
      : "Supplied runtime evidence: none.",
  ].join("\n\n");

  return [
    { role: "system", content: system },
    ...conversationMessages,
  ];
}

async function* parseDeepSeekSse(stream: ReadableStream<Uint8Array>): AsyncIterable<DeepSeekStreamChunk> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const chunk = parseSseLine(line);
        if (chunk) yield chunk;
      }
    }
    buffer += decoder.decode();
    for (const line of buffer.split(/\r?\n/)) {
      const chunk = parseSseLine(line);
      if (chunk) yield chunk;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseSseLine(line: string): DeepSeekStreamChunk | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return undefined;
  const data = trimmed.slice("data:".length).trim();
  if (!data || data === "[DONE]") return undefined;
  return JSON.parse(data) as DeepSeekStreamChunk;
}

function normalizeDelta(value: string | null | undefined): string {
  return typeof value === "string" ? value : "";
}

function safeJsonForPrompt(value: unknown, maxLength: number): string {
  const json = JSON.stringify(value ?? {});
  if (json.length <= maxLength) return json;
  return `${json.slice(0, maxLength)}... [truncated]`;
}
