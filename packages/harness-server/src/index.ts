import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { harnessRunRequestSchema, type HarnessRunEvent } from "@typedance/harness-contracts";
import type { HarnessRuntime } from "@typedance/harness-core";
export * from "./mcp/stdio-connector";

export type HarnessRunServerOptions = {
  runtime: HarnessRuntime;
};

export type HarnessRunHttpServer = {
  nodeServer: Server;
  get url(): string;
  listen(port?: number, hostname?: string): void;
  close(): Promise<void>;
};

type RouteContext = {
  runtime: HarnessRuntime;
  request: IncomingMessage;
  response: ServerResponse;
  pathname: string;
};

export function createHarnessRunServer(options: HarnessRunServerOptions): HarnessRunHttpServer {
  const nodeServer = createServer((request, response) => {
    void handleRequest({
      runtime: options.runtime,
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
        throw new Error("Harness run server is not listening");
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
      error: "harness_server_error",
      message: error instanceof Error ? error.message : "Unknown server error",
    });
  }
}

async function route(context: RouteContext): Promise<boolean> {
  const { request, response, runtime, pathname } = context;

  if (request.method === "POST" && pathname === "/runs") {
    const body = await readJson(request);
    const run = runtime.createRun(harnessRunRequestSchema.parse(body));
    writeJson(response, 201, run);
    return true;
  }

  const runEventsMatch = /^\/runs\/([^/]+)\/events$/.exec(pathname);
  if (request.method === "GET" && runEventsMatch) {
    const runId = decodeURIComponent(runEventsMatch[1] ?? "");
    const url = new URL(request.url ?? "/", "http://localhost");
    const afterSequence = Number(url.searchParams.get("after") ?? "-1");
    await streamEvents(runtime, request, response, runId, Number.isFinite(afterSequence) ? afterSequence : -1);
    return true;
  }

  const runInputMatch = /^\/runs\/([^/]+)\/input$/.exec(pathname);
  if (request.method === "POST" && runInputMatch) {
    const event = context.runtime.recordUserInput(decodeURIComponent(runInputMatch[1] ?? ""), await readJson(request));
    writeJson(response, 200, event);
    return true;
  }

  const runCancelMatch = /^\/runs\/([^/]+)\/cancel$/.exec(pathname);
  if (request.method === "POST" && runCancelMatch) {
    const body = await readJson(request);
    const event = context.runtime.cancelRun(decodeURIComponent(runCancelMatch[1] ?? ""), optionalString(body.reason));
    writeJson(response, 200, event);
    return true;
  }

  const runMatch = /^\/runs\/([^/]+)$/.exec(pathname);
  if (request.method === "GET" && runMatch) {
    writeJson(response, 200, context.runtime.getRun(decodeURIComponent(runMatch[1] ?? "")));
    return true;
  }

  const permissionMatch = /^\/permissions\/([^/]+)\/resolve$/.exec(pathname);
  if (request.method === "POST" && permissionMatch) {
    const body = await readJson(request);
    const decision = context.runtime.resolvePermission({
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

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parsePermissionStatus(value: unknown): "approved" | "denied" {
  if (value === "approved" || value === "denied") {
    return value;
  }
  throw new Error("Permission status must be approved or denied");
}

function parsePermissionRemember(value: unknown): "never" | "run" | "context" | "always" | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "never" || value === "run" || value === "context" || value === "always") {
    return value;
  }
  throw new Error("Permission remember must be never, run, context, or always");
}
