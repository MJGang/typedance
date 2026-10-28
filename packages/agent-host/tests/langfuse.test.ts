import { once } from "node:events";
import { createServer } from "node:http";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { InMemorySpanExporter, type ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { LangfuseOtelSpanAttributes as Attr } from "@langfuse/tracing";
import { ExportResultCode } from "@opentelemetry/core";
import { createHarnessRuntime, HarnessToolOutput, type HarnessModelAdapter } from "@typedance/harness-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentHost, createDeepSeekModelAdapter, createLangfuseTelemetry, type LangfuseTelemetry } from "../src";

const instances: LangfuseTelemetry[] = [];
afterEach(async () => { await Promise.all(instances.splice(0).map((instance) => instance.shutdown())); });
const env = { LANGFUSE_ENABLED: "true", LANGFUSE_BASE_URL: "http://127.0.0.1:3000", LANGFUSE_PUBLIC_KEY: "pk-test", LANGFUSE_SECRET_KEY: "sk-test", LANGFUSE_CAPTURE_CONTENT: "true" };
function telemetry(overrides: NodeJS.ProcessEnv = {}) {
  const exporter = new InMemorySpanExporter();
  const instance = createLangfuseTelemetry({ ...env, ...overrides }, { exporter })!;
  instances.push(instance);
  return { ...instance, exporter };
}
function setup(instance: LangfuseTelemetry, model: HarnessModelAdapter, loadContext?: () => Promise<never>) {
  const runtime = createHarnessRuntime({ observer: instance.observer, model });
  runtime.registerPlugin({ id: "test", name: "Test", version: "1", module_format: "esm", scopes: ["test"], agents: [{ id: "test.agent", name: "Test", role: "primary", allowed_tool_names: ["test.tool"] }] });
  const host = createAgentHost({ runtime, contextProvider: loadContext ? { loadContext } : undefined, packs: [{ id: "resume", primaryAgentId: "test.agent", capabilityPolicy: { pluginIds: ["test"] } }] });
  const start = (content = "hello") => {
    const conversation = host.createConversation("ws");
    const run = host.startConversationRun("ws", conversation.id, { message: { content } });
    return { run, conversation };
  };
  return { runtime, host, start };
}
function metadata(span: ReadableSpan, key: string) {
  const value = span.attributes[`${Attr.OBSERVATION_METADATA}.${key}`];
  return typeof value === "string" ? JSON.parse(value) : value;
}
function sse(chunks: unknown[]) { return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n"); }

describe("Langfuse agent tracing", () => {
  it("aggregates progress while retaining runtime events and summarizes images only in exported inputs", async () => {
    const instance = telemetry();
    const bytes = Buffer.alloc(18000, 97);
    const image = `data:image/png;base64,${bytes.toString("base64")}`;
    let pass = 0;
    const { runtime, host, start } = setup(instance, { async *stream(request) {
      if (++pass === 1) yield { type: "tool_call", call: { id: "image", name: "test.tool", origin: "plugin", input: {} } };
      else {
        expect(JSON.stringify(request.prompt)).toContain(image);
        yield { type: "assistant_delta", messageId: "done", delta: "看到了页面" };
      }
      yield { type: "final", output: {} };
    } });
    runtime.registerTool({ name: "test.tool", origin: "plugin", handler: () => new HarnessToolOutput({}, [{ type: "image", image_url: image, detail: "high" }]) });
    const { run } = start();
    await host.waitForRun(run.id); await instance.flush();
    const spans = instance.exporter.getFinishedSpans();
    const progress = host.listAgentRunEvents(run.id).filter(event => event.type === "harness_event" && (event.payload.event as { type: string }).type === "model.call.progress");
    expect(progress.length).toBeGreaterThan(0);
    expect(spans.some(span => span.name === "model.call.progress")).toBe(false);
    expect(metadata(spans.find(span => span.name === "agent.run")!, "progress_events")).toBe(progress.length);
    const input = spans.filter(span => span.name === "model.generate")[1].attributes[Attr.OBSERVATION_INPUT];
    expect(String(input)).not.toContain("data:image/");
    expect(String(input)).toContain("inline_image");
    expect(String(input)).toContain(createHash("sha256").update(bytes).digest("hex"));
    expect(String(input)).toContain('"bytes":18000');
  });

  it("exports a host run, each model pass with real usage, and a recoverable tool failure in one trace", async () => {
    const instance = telemetry();
    let pass = 0;
    const model = createDeepSeekModelAdapter({
      resolveSettings: () => ({ apiKey: "sk-provider-secret", baseUrl: "https://example.test", defaultModel: "deepseek-test" }),
      fetch: vi.fn(async () => ++pass === 1 ? sse([
        { choices: [{ delta: { reasoning_content: "planning" } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "test_tool", arguments: '{"api_key":"private-value"}' } }] } }] },
        { choices: [], usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130, prompt_cache_hit_tokens: 20, prompt_cache_miss_tokens: 80, completion_tokens_details: { reasoning_tokens: 10 } } },
      ]) : sse([
        { choices: [{ delta: { content: "recovered" } }] },
        { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 150, completion_tokens: 5, total_tokens: 155 } },
      ])) as typeof fetch,
    });
    const { runtime, host, start } = setup(instance, model);
    runtime.registerTool({ name: "test.tool", origin: "plugin", handler: () => { throw new Error("Bearer secret-bearer sk-provider-secret"); } });
    const { run, conversation } = start("Use api_key=private-message");
    await host.waitForRun(run.id);
    await instance.flush();
    const spans = instance.exporter.getFinishedSpans();
    const root = spans.find((span) => span.name === "agent.run")!;
    const generations = spans.filter((span) => span.name === "model.generate");
    expect(host.getAgentRun(run.id).status).toBe("completed");
    expect(root.attributes[Attr.TRACE_SESSION_ID]).toBe(conversation.id);
    expect(metadata(root, "agent_run_id")).toBe(run.id);
    expect(metadata(root, "status")).toBe("completed");
    expect(generations).toHaveLength(2);
    const usage = JSON.parse(String(generations[0].attributes[Attr.OBSERVATION_USAGE_DETAILS]));
    expect(usage).toEqual({ input: 80, output: 20, total: 130, input_cached_tokens: 20, output_reasoning_tokens: 10 });
    expect(usage.input + usage.input_cached_tokens + usage.output + usage.output_reasoning_tokens).toBe(usage.total);
    expect(metadata(generations[0], "provider_usage")).toMatchObject({ inputTokens: 100, outputTokens: 30, cacheMissInputTokens: 80 });
    expect(generations[0].attributes[Attr.OBSERVATION_MODEL]).toBe("deepseek-test");
    expect(generations[0].attributes[Attr.OBSERVATION_COMPLETION_START_TIME]).toBeDefined();
    expect(generations[1].attributes[Attr.OBSERVATION_OUTPUT]).toContain("recovered");
    expect(spans.find((span) => span.name === "test.tool")?.attributes[Attr.OBSERVATION_LEVEL]).toBe("ERROR");
    expect(new Set(spans.map((span) => span.spanContext().traceId)).size).toBe(1);
    for (const child of spans.filter((span) => span !== root)) expect(child.parentSpanContext?.spanId).toBe(root.spanContext().spanId);
    const serialized = JSON.stringify(spans.map((span) => span.attributes));
    for (const secret of ["private-value", "private-message", "secret-bearer", "sk-provider-secret", "pk-test", "sk-test"]) expect(serialized).not.toContain(secret);
    expect(serialized).toContain("[REDACTED]");
  });

  it("isolates concurrent runs and captures failure during preparation", async () => {
    const instance = telemetry();
    const { host, start } = setup(instance, { async *stream() { await new Promise((resolve) => setTimeout(resolve, 5)); yield { type: "assistant_delta", messageId: "m", delta: "done" }; } });
    const first = start("one"); const second = start("two");
    await Promise.all([host.waitForRun(first.run.id), host.waitForRun(second.run.id)]);
    const failed = setup(instance, { async *stream() { throw new Error("must not run"); } }, async () => { throw new Error("context unavailable"); });
    const third = failed.start(); await failed.host.waitForRun(third.run.id);
    await instance.flush();
    const spans = instance.exporter.getFinishedSpans();
    const roots = spans.filter((span) => span.name === "agent.run");
    expect(roots).toHaveLength(3);
    expect(new Set(roots.map((span) => span.spanContext().traceId)).size).toBe(3);
    const failedRoot = roots.find((span) => metadata(span, "status") === "failed")!;
    expect(failedRoot.attributes[Attr.OBSERVATION_STATUS_MESSAGE]).toContain("context unavailable");
    expect(spans.filter((span) => span.spanContext().traceId === failedRoot.spanContext().traceId).map((span) => span.name).sort()).toEqual(["agent.prepare", "agent.run"]);
    for (const root of roots) {
      for (const child of spans.filter((span) => span !== root && span.spanContext().traceId === root.spanContext().traceId)) expect(child.parentSpanContext?.spanId).toBe(root.spanContext().spanId);
    }
  });

  it.each(["model", "tool"])("closes a canceled %s even when underlying work ignores cancellation", async (stage) => {
    const instance = telemetry();
    let entered!: () => void; const ready = new Promise<void>((resolve) => { entered = resolve; });
    let release!: () => void; const blocked = new Promise<void>((resolve) => { release = resolve; });
    const { runtime, host, start } = setup(instance, { async *stream() {
      yield { type: "assistant_delta", messageId: "m", delta: "partial" };
      if (stage === "model") { entered(); await blocked; }
      else yield { type: "tool_call", call: { id: "call", name: "test.tool", origin: "plugin", input: {} } };
    } });
    runtime.registerTool({ name: "test.tool", origin: "plugin", handler: async () => { entered(); await blocked; return {}; } });
    const { run } = start(); await ready;
    host.cancelAgentRun(run.id, "stop");
    await host.waitForRun(run.id); await instance.flush();
    const spans = instance.exporter.getFinishedSpans();
    expect(metadata(spans.find((span) => span.name === "agent.run")!, "status")).toBe("canceled");
    expect(metadata(spans.find((span) => span.name === (stage === "model" ? "model.generate" : "test.tool"))!, "status")).toBe("canceled");
    expect(new Set(spans.map((span) => span.spanContext().spanId)).size).toBe(spans.length);
    release(); await new Promise((resolve) => setTimeout(resolve, 0)); await instance.flush();
    expect(instance.exporter.getFinishedSpans()).toHaveLength(spans.length);
  });

  it("keeps content out by default and closes unfinished spans on idempotent shutdown", async () => {
    const instance = telemetry({ LANGFUSE_CAPTURE_CONTENT: undefined });
    const { runtime } = setup(instance, { async *stream() {} });
    const run = runtime.createRun({ user_message: "sensitive resume", context: { private: "secret data" }, capability_policy: {} });
    runtime.registerTool({ name: "test.tool", origin: "plugin", handler: () => "sensitive result" });
    await runtime.invokeTool(run.id, { id: "c", name: "test.tool", origin: "plugin", input: { value: "private input" } });
    runtime.failRun(run.id, { code: "test", message: "private failure" });
    await instance.flush();
    const attributes = instance.exporter.getFinishedSpans().map((span) => span.attributes);
    for (const attr of attributes) { expect(attr[Attr.OBSERVATION_INPUT]).toBeUndefined(); expect(attr[Attr.OBSERVATION_OUTPUT]).toBeUndefined(); }
    expect(JSON.stringify(attributes)).not.toMatch(/sensitive|private failure|secret data/);
    const pending = runtime.createRun({ user_message: "pending", context: {}, capability_policy: {} });
    runtime.startSubagent(pending.id, { subagentId: "child", name: "child" });
    // Observe the final export before the in-memory exporter clears itself at shutdown.
    const exported: ReadableSpan[] = [];
    const exportOriginal = instance.exporter.export.bind(instance.exporter);
    instance.exporter.export = (spans, callback) => { exported.push(...spans); exportOriginal(spans, callback); };
    await Promise.all([instance.shutdown(), instance.shutdown()]);
    expect(exported.find((span) => span.name === "child")?.attributes[Attr.OBSERVATION_LEVEL]).toBe("WARNING");
    expect(exported.find((span) => span.name === "agent.run")?.attributes[Attr.OBSERVATION_LEVEL]).toBe("WARNING");
  });

  it("records permission waits, verification, subagents, and other runtime events", async () => {
    const instance = telemetry();
    const { runtime } = setup(instance, { async *stream() {} });
    const run = runtime.createRun({ user_message: "test", context: {}, capability_policy: {} });
    runtime.registerTool({ name: "guarded", origin: "plugin", handler: () => ({}), requiresPermission: () => ({ kind: "filesystem.read", reason: "read", scope: { uri: "test", access: "read" } }) });
    const permission = await runtime.invokeTool(run.id, { id: "c", name: "guarded", origin: "plugin", input: {} });
    if (permission.status !== "permission_required") throw new Error("expected permission");
    runtime.resolvePermission({ requestId: permission.request.id, status: "approved" });
    runtime.startSubagent(run.id, { subagentId: "s", name: "research" });
    runtime.completeSubagent(run.id, { subagentId: "s", status: "completed" });
    runtime.registerVerification({ id: "v", name: "check", handler: async () => ({ status: "passed", summary: "ok" }) });
    await runtime.runVerification(run.id, "v", {});
    runtime.remember({ runId: run.id, scope: "run", key: "k", value: "v", summary: "saved" });
    runtime.completeRun(run.id); await instance.flush();
    const spans = instance.exporter.getFinishedSpans();
    expect(spans.map((span) => span.name)).toEqual(expect.arrayContaining(["permission.wait", "research", "check", "memory.updated"]));
    for (const span of spans) expect(span.attributes[Attr.OBSERVATION_LEVEL]).not.toBe("ERROR");
  });

  it("requires opt-in and validates configuration without exposing credentials", () => {
    expect(createLangfuseTelemetry({ ...env, LANGFUSE_ENABLED: undefined })).toBeUndefined();
    const warn = vi.fn();
    expect(createLangfuseTelemetry({ ...env, LANGFUSE_BASE_URL: "https://user:secret@example.test" }, { warn })).toBeUndefined();
    expect(createLangfuseTelemetry({ ...env, LANGFUSE_SECRET_KEY: undefined }, { warn })).toBeUndefined();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("sk-test");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("user:secret");
  });

  it("reports a provider failure on both generation and run", async () => {
    const instance = telemetry();
    const { host, start } = setup(instance, { async *stream() { throw new Error("provider unavailable"); } });
    const { run } = start(); await host.waitForRun(run.id); await instance.flush();
    const spans = instance.exporter.getFinishedSpans();
    expect(host.getAgentRun(run.id).status).toBe("failed");
    for (const name of ["model.generate", "agent.run"]) {
      const span = spans.find((item) => item.name === name)!;
      expect(span.attributes[Attr.OBSERVATION_LEVEL]).toBe("ERROR");
      expect(span.attributes[Attr.OBSERVATION_STATUS_MESSAGE]).toBe("provider unavailable");
    }
  });

  it.each([
    { usage: { inputTokens: 100, outputTokens: 30, totalTokens: 130 }, expected: { input: 100, output: 30, total: 130 } },
    { usage: { inputTokens: 100, cacheReadInputTokens: 100, cacheMissInputTokens: 0, outputTokens: 30, reasoningOutputTokens: 30, totalTokens: 130 }, expected: { input: 0, input_cached_tokens: 100, output: 0, output_reasoning_tokens: 30, total: 130 } },
    { usage: { inputTokens: 100, outputTokens: 30, cacheMissInputTokens: 80, totalTokens: 130 }, expected: { input: 100, output: 30, total: 130 } },
  ])("preserves totals with exclusive usage buckets: $expected", async ({ usage, expected }) => {
    const instance = telemetry();
    const { host, start } = setup(instance, { async *stream() { yield { type: "final", output: {}, usage }; } });
    const { run } = start(); await host.waitForRun(run.id); await instance.flush();
    const generation = instance.exporter.getFinishedSpans().find((span) => span.name === "model.generate")!;
    const details = JSON.parse(String(generation.attributes[Attr.OBSERVATION_USAGE_DETAILS]));
    expect(details).toEqual(expected);
    expect(Object.entries(details).filter(([key]) => key !== "total").reduce((sum, [, value]) => sum + Number(value), 0)).toBe(details.total);
  });

  it("keeps the agent successful when the exporter fails", async () => {
    const exportSpans = vi.fn((_spans, callback) => callback({ code: ExportResultCode.FAILED, error: new Error("collector unavailable") }));
    const instance = createLangfuseTelemetry(env, { exporter: { export: exportSpans, shutdown: async () => undefined }, warn: () => undefined })!;
    instances.push(instance);
    const { host, start } = setup(instance, { async *stream() { yield { type: "final", output: { ok: true } }; } });
    const { run } = start();
    await expect(host.waitForRun(run.id)).resolves.toEqual({ ok: true });
    await instance.flush().catch(() => undefined);
    expect(exportSpans).toHaveBeenCalled();
    expect(host.getAgentRun(run.id).status).toBe("completed");
  });

  it("sends authenticated OTLP HTTP to the configured instance", async () => {
    const received: { path?: string; auth?: string; body: string }[] = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const raw = Buffer.concat(chunks);
      received.push({ path: request.url, auth: request.headers.authorization, body: (request.headers["content-encoding"] === "gzip" ? gunzipSync(raw) : raw).toString("utf8") });
      response.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const address = server.address(); if (!address || typeof address === "string") throw new Error("no address");
    const instance = createLangfuseTelemetry({ ...env, LANGFUSE_BASE_URL: `http://127.0.0.1:${address.port}` })!;
    try {
      const { host, start } = setup(instance, { async *stream() { yield { type: "assistant_delta", messageId: "m", delta: "wire verified" }; } });
      const { run } = start(); await host.waitForRun(run.id); await instance.flush();
      expect(received.length).toBeGreaterThan(0);
      expect(received.every((request) => request.path === "/api/public/otel/v1/traces")).toBe(true);
      expect(received[0].auth).toBe(`Basic ${Buffer.from("pk-test:sk-test").toString("base64")}`);
      const wire = received.map((request) => request.body).join("");
      expect(wire).toContain("agent.run"); expect(wire).toContain("model.generate");
      expect(wire).not.toContain("sk-test");
      for (const request of received) expect(JSON.parse(request.body).resourceSpans.length).toBeGreaterThan(0);
    } finally {
      await instance.shutdown();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
