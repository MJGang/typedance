import { ROOT_CONTEXT, SpanStatusCode, trace, type Span, type Tracer } from "@opentelemetry/api";
import { BasicTracerProvider, type SpanExporter } from "@opentelemetry/sdk-trace-base";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
  createObservationAttributes,
  LangfuseOtelSpanAttributes as Attr,
  type LangfuseGenerationAttributes,
  type LangfuseObservationType,
} from "@langfuse/tracing";
import type { HarnessRunEvent } from "@typedance/harness-contracts";
import type { HarnessModelObservation, HarnessModelRequest, HarnessModelUsage, HarnessRuntimeObserver } from "@typedance/harness-core";

const MAX_TEXT = 16_000;
const REDACTED = "[REDACTED]";

type RunTrace = {
  root: Span;
  preparation?: Span;
  children: Map<string, { span: Span; type: LangfuseObservationType }>;
  generations: Set<(result?: { error?: unknown; canceled: boolean }) => void>;
  text: string;
  modelPasses: number;
};

export type LangfuseTelemetry = {
  observer: HarnessRuntimeObserver;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
};

/** Owns its provider and explicit parent contexts; never replaces global OTel state. */
export function createLangfuseTelemetry(
  env: NodeJS.ProcessEnv,
  options: { exporter?: SpanExporter; warn?: (message: string) => void } = {},
): LangfuseTelemetry | undefined {
  if (env.LANGFUSE_ENABLED !== "true") return undefined;
  const warn = options.warn ?? console.warn;
  const publicKey = env.LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = env.LANGFUSE_SECRET_KEY?.trim();
  let baseUrl: URL;
  try {
    baseUrl = new URL(env.LANGFUSE_BASE_URL?.trim() ?? "");
    if (!["http:", "https:"].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) throw new Error();
    if (!publicKey || !secretKey) throw new Error();
  } catch {
    warn("Langfuse 未启用：请配置 LANGFUSE_BASE_URL、LANGFUSE_PUBLIC_KEY 和 LANGFUSE_SECRET_KEY。");
    return undefined;
  }

  try {
    const processor = new LangfuseSpanProcessor({
      publicKey, secretKey, baseUrl: baseUrl.href.replace(/\/+$/, ""),
      environment: env.LANGFUSE_TRACING_ENVIRONMENT?.trim() || "development",
      release: env.LANGFUSE_RELEASE?.trim() || undefined,
      exporter: options.exporter,
      timeout: 3,
      flushInterval: 5,
      mediaUploadEnabled: false,
      shouldExportSpan: ({ otelSpan }) => otelSpan.instrumentationScope.name === "typedance.agent-host",
    });
    const provider = new BasicTracerProvider({ spanProcessors: [processor], forceFlushTimeoutMillis: 5_000 });
    let flushTask: Promise<void> = Promise.resolve();
    const flush = () => flushTask = flushTask.catch(() => undefined).then(() => provider.forceFlush());
    const observer = new LangfuseAgentObserver(
      provider.getTracer("typedance.agent-host"),
      env.LANGFUSE_CAPTURE_CONTENT === "true",
      [publicKey!, secretKey!],
      () => { void flush().catch(() => warn("Langfuse 上报失败，Agent 运行不受影响。")); },
    );
    let closing: Promise<void> | undefined;
    return {
      observer,
      flush,
      shutdown: () => closing ??= (async () => {
        observer.close();
        try { await flush(); } finally { await provider.shutdown(); }
      })(),
    };
  } catch {
    warn("Langfuse 初始化失败，Agent 将继续运行。");
    return undefined;
  }
}

class LangfuseAgentObserver implements HarnessRuntimeObserver {
  #runs = new Map<string, RunTrace>();
  #closed = false;
  constructor(
    private readonly tracer: Tracer,
    private readonly captureContent: boolean,
    private readonly secrets: string[],
    private readonly flush: () => void,
  ) {}

  #attributes(type: LangfuseObservationType, attributes: LangfuseGenerationAttributes) {
    const { input, output, ...rest } = attributes;
    return createObservationAttributes(type, {
      ...rest,
      ...(this.captureContent ? { input: this.#sanitize(input), output: this.#sanitize(output) } : {}),
    });
  }

  #sanitize(value: unknown, depth = 0): unknown {
    if (depth > 8) return "[TRUNCATED]";
    if (typeof value === "string") {
      let text = value;
      for (const secret of this.secrets) text = text.replaceAll(secret, REDACTED);
      text = text.replace(/\bBearer\s+[^\s"',}]+/gi, `Bearer ${REDACTED}`)
        .replace(/\bsk-[A-Za-z0-9_-]+/g, REDACTED)
        .replace(/((?:api[_-]?key|secret|password|authorization|access[_-]?token)["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, `$1${REDACTED}`);
      return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + "[TRUNCATED]" : text;
    }
    if (Array.isArray(value)) return value.slice(0, 100).map((item) => this.#sanitize(item, depth + 1));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [
      key, /api[_-]?key|secret|password|authorization|cookie|token(?!s)/i.test(key) ? REDACTED : this.#sanitize(item, depth + 1),
    ]));
    return value;
  }

  #start(run: RunTrace, name: string, type: LangfuseObservationType, attributes: LangfuseGenerationAttributes, time?: string): Span {
    return this.tracer.startSpan(name, {
      startTime: time ? new Date(time) : undefined,
      attributes: this.#attributes(type, attributes),
    }, trace.setSpan(ROOT_CONTEXT, run.root));
  }

  #end(span: Span, type: LangfuseObservationType, status: string, output?: unknown, message?: string, time?: string): void {
    const failed = status === "failed";
    const canceled = status === "canceled";
    span.setAttributes(this.#attributes(type, {
      output,
      metadata: { status },
      level: failed ? "ERROR" : canceled ? "WARNING" : "DEFAULT",
      statusMessage: message ? String(this.#sanitize(this.captureContent ? message : status)) : undefined,
    }));
    span.setStatus({ code: failed ? SpanStatusCode.ERROR : canceled ? SpanStatusCode.UNSET : SpanStatusCode.OK });
    span.end(time ? new Date(time) : undefined);
  }

  onRunEvent(event: HarnessRunEvent): void {
    if (this.#closed) return;
    if (event.type === "run.started") {
      const context = event.input.context as Record<string, unknown> | undefined;
      const metadata: Record<string, unknown> = { harness_run_id: event.run_id };
      for (const key of ["workspace_id", "conversation_id", "pack_id", "agent_run_id", "mutation_mode"]) {
        if (typeof context?.[key] === "string") metadata[key] = context[key];
      }
      const root = this.tracer.startSpan("agent.run", {
        startTime: new Date(event.created_at),
        attributes: {
          ...this.#attributes("agent", { input: event.input.user_message, metadata }),
          [Attr.TRACE_NAME]: "TypeDance Agent",
          ...(typeof context?.conversation_id === "string" ? { [Attr.TRACE_SESSION_ID]: context.conversation_id } : {}),
        },
      }, ROOT_CONTEXT);
      const run: RunTrace = { root, children: new Map(), generations: new Set(), text: "", modelPasses: 0 };
      this.#runs.set(event.run_id, run);
      run.preparation = this.#start(run, "agent.prepare", "chain", {}, event.created_at);
      return;
    }
    const run = this.#runs.get(event.run_id);
    if (!run) return;
    if (event.type === "assistant.delta") {
      if (this.captureContent) run.text = (run.text + event.delta).slice(0, MAX_TEXT);
      return;
    }
    if (event.type === "reasoning.summary.delta" || event.type === "tool.call.delta") return;
    if (event.type === "run.completed" || event.type === "run.failed" || event.type === "run.canceled") {
      const status = event.type.slice(4);
      for (const end of run.generations) end({ canceled: event.type === "run.canceled", error: event.type === "run.failed" ? new Error(event.error.message) : undefined });
      if (run.preparation) this.#end(run.preparation, "chain", status, undefined, undefined, event.created_at);
      for (const child of run.children.values()) this.#end(child.span, child.type, status === "completed" ? "canceled" : status, undefined, undefined, event.created_at);
      const output = event.type === "run.completed" ? { text: run.text, ...event.output } : event;
      run.root.setAttributes(this.#attributes("agent", { metadata: { model_passes: run.modelPasses } }));
      this.#end(run.root, "agent", status, output, event.type === "run.failed" ? event.error.message : event.type === "run.canceled" ? event.reason : undefined, event.created_at);
      this.#runs.delete(event.run_id);
      this.flush();
      return;
    }

    let start: { key: string; name: string; type: LangfuseObservationType; input?: unknown; metadata?: Record<string, unknown> } | undefined;
    let end: { key: string; status: string; output?: unknown; message?: string } | undefined;
    switch (event.type) {
      case "tool.call.started": start = { key: `tool:${event.tool_call.id}`, name: event.tool_call.name, type: "tool", input: event.tool_call.input, metadata: { tool_call_id: event.tool_call.id, origin: event.tool_call.origin } }; break;
      case "tool.call.completed": end = { key: `tool:${event.result.tool_call_id}`, status: event.result.status, output: event.result.output, message: event.result.error?.message }; break;
      case "subagent.started": start = { key: `agent:${event.subagent_id}`, name: event.name, type: "agent" }; break;
      case "subagent.completed": end = { key: `agent:${event.subagent_id}`, status: event.status, output: event.summary }; break;
      case "verification.started": start = { key: `verification:${event.verification_id}`, name: event.name, type: "evaluator" }; break;
      case "verification.completed": end = { key: `verification:${event.verification_id}`, status: event.status === "passed" ? "completed" : event.status, output: event.summary }; break;
      case "permission.requested": start = { key: `permission:${event.request.id}`, name: "permission.wait", type: "guardrail", input: event.request }; break;
      case "permission.resolved": end = { key: `permission:${event.decision.request_id}`, status: event.decision.status === "approved" ? "completed" : "failed", output: event.decision }; break;
    }
    if (start) {
      run.children.set(start.key, { span: this.#start(run, start.name, start.type, { input: start.input, metadata: start.metadata }, event.created_at), type: start.type });
    } else if (end) {
      const child = run.children.get(end.key);
      if (child) {
        this.#end(child.span, child.type, end.status, end.output, end.message, event.created_at);
        run.children.delete(end.key);
      }
    } else {
      this.#start(run, event.type, "event", { input: event }, event.created_at).end(new Date(event.created_at));
    }
  }

  onModelStart(request: HarnessModelRequest): HarnessModelObservation | undefined {
    const run = this.#runs.get(request.runId);
    if (!run) return undefined;
    if (run.preparation) {
      this.#end(run.preparation, "chain", "completed");
      run.preparation = undefined;
    }
    const span = this.#start(run, "model.generate", "generation", {
      model: request.model,
      input: request.prompt,
      metadata: { agent_id: request.agentId, model_pass: ++run.modelPasses, tool_names: request.availableToolNames },
    });
    let text = "";
    let reasoning = "";
    const calls: unknown[] = [];
    let output: unknown;
    let firstToken = false;
    let ended = false;
    const finish = (result?: { error?: unknown; canceled: boolean }) => {
      if (ended) return;
      ended = true;
      run.generations.delete(finish);
      const canceled = result?.canceled || request.signal.aborted;
      this.#end(span, "generation", canceled ? "canceled" : result?.error ? "failed" : "completed", { text, reasoning, tool_calls: calls, result: output }, result?.error instanceof Error ? result.error.message : undefined);
    };
    run.generations.add(finish);
    return {
      onEvent: (event) => {
        if (ended) return;
        if (!firstToken && (event.type === "assistant_delta" || event.type === "reasoning_summary_delta" || event.type === "tool_call")) {
          firstToken = true;
          span.setAttributes(createObservationAttributes("generation", { completionStartTime: new Date() }));
        }
        if (this.captureContent) {
          if (event.type === "assistant_delta") text = (text + event.delta).slice(0, MAX_TEXT);
          if (event.type === "reasoning_summary_delta") reasoning = (reasoning + event.delta).slice(0, MAX_TEXT);
          if (event.type === "tool_call" && calls.length < 100) calls.push(event.call);
        }
        if (event.type === "final") {
          output = event.output;
          span.setAttributes(createObservationAttributes("generation", {
            ...(typeof event.output.model === "string" ? { model: event.output.model } : {}),
            ...(event.usage ? { usageDetails: usageDetails(event.usage) } : {}),
            ...(event.usage ? { metadata: { provider_usage: event.usage } } : {}),
          }));
        }
      },
      end: finish,
    };
  }

  close(): void {
    this.#closed = true;
    for (const run of this.#runs.values()) {
      for (const end of run.generations) end({ canceled: true });
      if (run.preparation) this.#end(run.preparation, "chain", "canceled");
      for (const child of run.children.values()) this.#end(child.span, child.type, "canceled");
      this.#end(run.root, "agent", "canceled", undefined, "Agent Host shutdown");
    }
    this.#runs.clear();
  }
}

function usageDetails(usage: HarnessModelUsage): Record<string, number> {
  const details: Record<string, number> = {};
  const valid = (value: number | undefined): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
  for (const [key, inclusive, subsetKey, subset] of [
    ["input", usage.inputTokens, "input_cached_tokens", usage.cacheReadInputTokens],
    ["output", usage.outputTokens, "output_reasoning_tokens", usage.reasoningOutputTokens],
  ] as const) {
    // Flat Langfuse usage is stored unchanged: each token belongs to exactly one bucket.
    const knownSubset = valid(subset) && (!valid(inclusive) || subset <= inclusive);
    if (valid(inclusive)) details[key] = inclusive - (knownSubset ? subset : 0);
    if (knownSubset) details[subsetKey] = subset;
  }
  if (valid(usage.totalTokens)) details.total = usage.totalTokens;
  // Cache misses are already in input; preserve the provider's count only in metadata.
  return details;
}
