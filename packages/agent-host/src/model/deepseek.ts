import type {
  HarnessModelAdapter,
  HarnessModelMessage,
  HarnessModelTool,
  HarnessModelRequest,
  HarnessModelStreamEvent,
} from "@typedance/harness-core";
import { renderAgentHostPromptSections } from "../prompt";

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
  tool_calls?: DeepSeekToolCallDelta[];
};

type DeepSeekStreamChunk = {
  choices?: Array<{
    delta?: DeepSeekStreamDelta;
    finish_reason?: string | null;
  }>;
};

type DeepSeekTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type DeepSeekToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

type DeepSeekToolCallDelta = {
  index?: number;
  id?: string;
  type?: "function";
  function?: {
    name?: string | null;
    arguments?: string | null;
  };
};

type DeepSeekMessage =
  | {
      role: "system" | "user";
      content: string;
    }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: DeepSeekToolCall[];
    }
  | {
      role: "tool";
      tool_call_id: string;
      content: string;
    };

const DEFAULT_BASE_URL = "https://api.deepseek.com";

export function createDeepSeekModelAdapter(options: DeepSeekModelAdapterOptions): HarnessModelAdapter {
  const apiKey = options.apiKey.trim();
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is required");
  }

  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const defaultModel = options.defaultModel?.trim();

  return {
    async *stream(request: HarnessModelRequest): AsyncIterable<HarnessModelStreamEvent> {
      const model = resolveModelName(request, defaultModel);
      const toolNameMap = createProviderToolNameMap(request.availableTools);
      const tools = buildDeepSeekTools(request.availableTools, toolNameMap);

      const response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: buildDeepSeekMessages(request, toolNameMap),
          stream: true,
          ...(tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
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
      const toolCalls = new Map<number, DeepSeekToolCall>();
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

        for (const toolCallDelta of delta?.tool_calls ?? []) {
          const index = toolCallDelta.index ?? toolCalls.size;
          const current = toolCalls.get(index) ?? {
            id: toolCallDelta.id ?? `tool_call_${index}`,
            type: "function" as const,
            function: {
              name: "",
              arguments: "",
            },
          };
          if (toolCallDelta.id) current.id = toolCallDelta.id;
          if (toolCallDelta.function?.name) current.function.name += toolCallDelta.function.name;
          if (toolCallDelta.function?.arguments) current.function.arguments += toolCallDelta.function.arguments;
          toolCalls.set(index, current);
        }
      }

      for (const toolCall of [...toolCalls.entries()].sort(([left], [right]) => left - right).map(([, call]) => call)) {
        const name = toolNameMap.toHarnessName.get(toolCall.function.name) ?? toolCall.function.name;
        yield {
          type: "tool_call",
          call: {
            id: toolCall.id,
            name,
            origin: request.availableTools.find((tool) => tool.name === name)?.origin ?? "plugin",
            input: parseToolArguments(toolCall.function.arguments),
          },
        };
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

function resolveModelName(request: HarnessModelRequest, defaultModel: string | undefined): string {
  const model = request.model?.trim() || defaultModel;
  if (!model) {
    throw new Error("DeepSeek model must be provided by request.model or adapter defaultModel");
  }
  return model;
}

function buildDeepSeekMessages(
  request: HarnessModelRequest,
  toolNameMap: ProviderToolNameMap
): DeepSeekMessage[] {
  const system = renderAgentHostPromptSections([...request.prompt.developer, ...request.prompt.contextual]);

  return [
    ...(system ? [{ role: "system" as const, content: system }] : []),
    ...request.prompt.conversation.map((message) => toDeepSeekMessage(message, toolNameMap)),
  ];
}

function toDeepSeekMessage(message: HarnessModelMessage, toolNameMap: ProviderToolNameMap): DeepSeekMessage {
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      content: message.content,
    };
  }
  if (message.role === "assistant") {
    const toolCalls = message.toolCalls?.map((call) => ({
      id: call.id,
      type: "function" as const,
      function: {
        name: toolNameMap.toProviderName.get(call.name) ?? call.name,
        arguments: JSON.stringify(call.input ?? {}),
      },
    }));
    return {
      role: "assistant",
      content: message.content || null,
      ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    };
  }
  return {
    role: message.role,
    content: message.content,
  };
}

type ProviderToolNameMap = {
  toProviderName: Map<string, string>;
  toHarnessName: Map<string, string>;
};

function createProviderToolNameMap(tools: HarnessModelTool[]): ProviderToolNameMap {
  const used = new Set<string>();
  const toProviderName = new Map<string, string>();
  const toHarnessName = new Map<string, string>();
  for (const tool of tools) {
    const base = normalizeProviderToolName(tool.name);
    let providerName = base;
    let suffix = 2;
    while (used.has(providerName)) {
      providerName = `${base}_${suffix}`;
      suffix += 1;
    }
    used.add(providerName);
    toProviderName.set(tool.name, providerName);
    toHarnessName.set(providerName, tool.name);
  }
  return { toProviderName, toHarnessName };
}

function normalizeProviderToolName(name: string): string {
  const normalized = name.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/^_+/, "");
  return normalized || "tool";
}

function buildDeepSeekTools(tools: HarnessModelTool[], toolNameMap: ProviderToolNameMap): DeepSeekTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: toolNameMap.toProviderName.get(tool.name) ?? tool.name,
      description: tool.description,
      parameters: normalizeToolInputSchema(tool.inputSchema),
    },
  }));
}

function normalizeToolInputSchema(schema: Record<string, unknown> | undefined): Record<string, unknown> {
  if (schema && typeof schema === "object") {
    return schema;
  }
  return {
    type: "object",
    properties: {},
  };
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

function parseToolArguments(value: string): Record<string, unknown> {
  if (!value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // The tool registry will validate the final call shape; malformed provider
    // arguments are surfaced as an empty input rather than leaking provider text.
  }
  return {};
}
