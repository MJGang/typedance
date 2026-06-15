import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { HarnessRun, HarnessRunEvent } from "@typedance/harness-contracts";
import type { HarnessRuntime } from "@typedance/harness-core";

export type AgentHostCapabilityPolicy = {
  scopeIds?: string[];
  pluginIds?: string[];
};

export type AgentHostPackDefinition = {
  id: string;
  capabilityPolicy: AgentHostCapabilityPolicy;
  primaryAgentId: string;
  defaultContext?: Record<string, unknown>;
};

export type AgentHostStartRunInput = {
  action?: string;
  userMessage: string;
  context?: Record<string, unknown>;
};

export type AgentHostOptions = {
  runtime: HarnessRuntime;
  packs: AgentHostPackDefinition[];
};

export class AgentHost {
  readonly runtime: HarnessRuntime;
  #packs = new Map<string, AgentHostPackDefinition>();
  #runTasks = new Map<string, Promise<Record<string, unknown>>>();

  constructor(options: AgentHostOptions) {
    this.runtime = options.runtime;
    for (const pack of options.packs) {
      if (this.#packs.has(pack.id)) {
        throw new Error(`Duplicate agent host pack: ${pack.id}`);
      }
      this.#packs.set(pack.id, pack);
    }
  }

  listPacks(): AgentHostPackDefinition[] {
    return [...this.#packs.values()];
  }

  getPack(packId: string): AgentHostPackDefinition {
    const pack = this.#packs.get(packId);
    if (!pack) {
      throw new Error(`Unknown agent host pack: ${packId}`);
    }
    return pack;
  }

  startPackRun(packId: string, input: AgentHostStartRunInput): HarnessRun {
    const pack = this.getPack(packId);
    const context = {
      ...pack.defaultContext,
      ...input.context,
      pack_id: pack.id,
      ...(input.action ? { action: input.action } : {}),
    };
    const run = this.runtime.createRun({
      capability_policy: {
        scope_ids: [...new Set(pack.capabilityPolicy.scopeIds ?? [])],
        plugin_ids: [...new Set(pack.capabilityPolicy.pluginIds ?? [])],
      },
      user_message: input.userMessage,
      context,
    });

    const task = this.#startAgentTurn(pack, run, input.userMessage, context);
    this.#runTasks.set(run.id, task);
    void task.finally(() => {
      this.#runTasks.delete(run.id);
    });
    return run;
  }

  async waitForRun(runId: string): Promise<Record<string, unknown> | undefined> {
    return this.#runTasks.get(runId);
  }

  async #startAgentTurn(
    pack: AgentHostPackDefinition,
    run: HarnessRun,
    userMessage: string,
    context: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    try {
      return await this.runtime.runAgentTurn({
        runId: run.id,
        agentId: pack.primaryAgentId,
        messages: [{ role: "user", content: userMessage }],
        context,
      });
    } catch (error) {
      this.runtime.failRun(run.id, {
        code: "agent_turn_failed",
        message: error instanceof Error ? error.message : "Agent turn failed",
      });
      throw error;
    }
  }
}

export function createAgentHost(options: AgentHostOptions): AgentHost {
  return new AgentHost(options);
}

export type AgentHostServerOptions = {
  host: AgentHost;
};

export type AgentHostHttpServer = {
  nodeServer: Server;
  get url(): string;
  listen(port?: number, hostname?: string): void;
  close(): Promise<void>;
};

type RouteContext = {
  host: AgentHost;
  request: IncomingMessage;
  response: ServerResponse;
  pathname: string;
};

export function createAgentHostServer(options: AgentHostServerOptions): AgentHostHttpServer {
  const nodeServer = createServer((request, response) => {
    void handleRequest({
      host: options.host,
      request,
      response,
      pathname: new URL(request.url ?? "/", "http://localhost").pathname,
    });
  });

  return {
    nodeServer,
    get url() {
      const address = nodeServer.address() as AddressInfo | null;
      if (!address) {
        throw new Error("Agent host server is not listening");
      }
      return `http://${address.address}:${address.port}`;
    },
    listen(port = 0, hostname = "127.0.0.1") {
      nodeServer.listen(port, hostname);
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        nodeServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

async function handleRequest(context: RouteContext): Promise<void> {
  setCorsHeaders(context.response);

  if (context.request.method === "OPTIONS") {
    context.response.writeHead(204).end();
    return;
  }

  try {
    const handled = await route(context);
    if (!handled) {
      writeJson(context.response, 404, { error: "not_found" });
    }
  } catch (error) {
    writeJson(context.response, 500, {
      error: "agent_host_error",
      message: error instanceof Error ? error.message : "Unknown agent host error",
    });
  }
}

async function route(context: RouteContext): Promise<boolean> {
  const { host, request, response, pathname } = context;

  const packRunMatch = /^\/packs\/([^/]+)\/runs$/.exec(pathname);
  if (request.method === "POST" && packRunMatch) {
    const packId = decodeURIComponent(packRunMatch[1] ?? "");
    const body = await readJson(request);
    const run = host.startPackRun(packId, {
      action: optionalString(body.action),
      userMessage: requiredString(body.user_message, "user_message"),
      context: objectRecord(body.context),
    });
    writeJson(response, 201, run);
    return true;
  }

  const runEventsMatch = /^\/runs\/([^/]+)\/events$/.exec(pathname);
  if (request.method === "GET" && runEventsMatch) {
    const runId = decodeURIComponent(runEventsMatch[1] ?? "");
    const url = new URL(request.url ?? "/", "http://localhost");
    const afterSequence = Number(url.searchParams.get("after") ?? "-1");
    await streamEvents(host.runtime, request, response, runId, Number.isFinite(afterSequence) ? afterSequence : -1);
    return true;
  }

  const runMatch = /^\/runs\/([^/]+)$/.exec(pathname);
  if (request.method === "GET" && runMatch) {
    writeJson(response, 200, host.runtime.getRun(decodeURIComponent(runMatch[1] ?? "")));
    return true;
  }

  const inputMatch = /^\/runs\/([^/]+)\/input$/.exec(pathname);
  if (request.method === "POST" && inputMatch) {
    const event = host.runtime.recordUserInput(decodeURIComponent(inputMatch[1] ?? ""), await readJson(request));
    writeJson(response, 200, event);
    return true;
  }

  const cancelMatch = /^\/runs\/([^/]+)\/cancel$/.exec(pathname);
  if (request.method === "POST" && cancelMatch) {
    const body = await readJson(request);
    const event = host.runtime.cancelRun(decodeURIComponent(cancelMatch[1] ?? ""), optionalString(body.reason));
    writeJson(response, 200, event);
    return true;
  }

  const permissionMatch = /^\/permissions\/([^/]+)\/resolve$/.exec(pathname);
  if (request.method === "POST" && permissionMatch) {
    const body = await readJson(request);
    const decision = host.runtime.resolvePermission({
      requestId: decodeURIComponent(permissionMatch[1] ?? ""),
      status: parsePermissionStatus(body.status),
      remember: parsePermissionRemember(body.remember),
    });
    writeJson(response, 200, decision);
    return true;
  }

  return false;
}

async function streamEvents(
  runtime: HarnessRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  runId: string,
  afterSequence: number
): Promise<void> {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  response.flushHeaders();

  const stream = runtime.streamEvents(runId, { afterSequence });
  request.on("close", () => {
    void stream.return?.();
    response.destroy();
  });

  for await (const event of stream) {
    response.write(formatSseEvent(event));
  }
}

function formatSseEvent(event: HarnessRunEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function setCorsHeaders(response: ServerResponse): void {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (!text) {
        resolve({});
        return;
      }

      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          resolve(parsed as Record<string, unknown>);
          return;
        }
        reject(new Error("JSON body must be an object"));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function requiredString(value: unknown, field: string): string {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  throw new Error(`${field} must be a non-empty string`);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error("context must be an object");
}

function parsePermissionStatus(value: unknown): "approved" | "denied" {
  if (value === "approved" || value === "denied") {
    return value;
  }
  throw new Error("Permission status must be approved or denied");
}

function parsePermissionRemember(value: unknown): "never" | "run" | "workspace" | "always" | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "never" || value === "run" || value === "workspace" || value === "always") {
    return value;
  }
  throw new Error("Permission remember must be never, run, workspace, or always");
}
