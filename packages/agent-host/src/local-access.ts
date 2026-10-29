import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

export type LocalAccessOptions = { authToken: string; allowedOrigins?: readonly string[] };

export function requireLocalToken(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9_-]{32,512}$/.test(value)) throw new Error("A desktop-issued local service token is required");
  return value;
}

export function isLoopbackHost(value: string): boolean {
  return /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(value);
}

/** Only the desktop coordinator distributes this account process's capability. */
export function createLocalAccess(options: LocalAccessOptions) {
  const token = requireLocalToken(options.authToken);
  const expected = Buffer.from(`Bearer ${token}`);
  const origins = new Set(options.allowedOrigins ?? [
    "http://tauri.localhost", "https://tauri.localhost", "tauri://localhost",
    "http://127.0.0.1:5173", "http://localhost:5173",
  ]);
  return (request: IncomingMessage, response: ServerResponse, pathname: string): boolean => {
    const counts = new Map<string, number>();
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      const name = request.rawHeaders[index]!.toLowerCase();
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    if (counts.get("host") !== 1 || !isLoopbackHost(request.headers.host ?? "")) throw new HttpError(403, "invalid_host");
    if ((counts.get("origin") ?? 0) > 1) throw new HttpError(403, "untrusted_origin");
    const origin = request.headers.origin;
    if (origin && !origins.has(origin)) throw new HttpError(403, "untrusted_origin");
    if (origin) {
      response.setHeader("access-control-allow-origin", origin);
      response.setHeader("vary", "Origin");
    }
    response.setHeader("cache-control", "no-store");
    if (request.method === "OPTIONS") {
      if (!origin) throw new HttpError(403, "origin_required");
      response.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
      response.setHeader("access-control-allow-headers", "content-type,authorization");
      response.writeHead(204).end();
      return true;
    }
    if (counts.get("authorization") !== 1) throw new HttpError(401, "unauthorized");
    const actual = Buffer.from(request.headers.authorization ?? "");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new HttpError(401, "unauthorized");
    return false;
  };
}

export function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const limit = 8_388_608;
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let exceeded = Number(request.headers["content-length"] ?? 0) > limit;
    request.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > limit) {
        if (!exceeded) { exceeded = true; chunks.length = 0; }
      } else if (!exceeded) chunks.push(chunk);
    });
    request.on("error", reject);
    request.on("end", () => {
      // 排空请求再返回 413，避免客户端仍上传时连接被关闭而得到 ECONNRESET。
      if (exceeded) { reject(new HttpError(413, "request_too_large")); return; }
      try {
        const text = Buffer.concat(chunks).toString("utf8").trim();
        const value: unknown = text ? JSON.parse(text) : {};
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected object");
        resolve(value as Record<string, unknown>);
      } catch { reject(new HttpError(400, "invalid_json")); }
    });
  });
}
