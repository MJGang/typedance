import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

export type LocalAccessOptions = { authToken?: string; allowedOrigins?: readonly string[] };

/** Browser bootstrap is restricted to the app's exact origins; API calls require a process-scoped token. */
export function createLocalAccess(options: LocalAccessOptions) {
  const token = options.authToken ?? randomBytes(32).toString("hex");
  if (token.length < 32) throw new Error("Agent Host auth token must contain at least 32 characters");
  const expected = Buffer.from(`Bearer ${token}`);
  const origins = new Set(options.allowedOrigins ?? [
    "http://tauri.localhost", "https://tauri.localhost", "tauri://localhost",
    "http://127.0.0.1:5173", "http://localhost:5173",
  ]);
  return (request: IncomingMessage, response: ServerResponse, pathname: string): boolean => {
    const hostname = new URL(`http://${request.headers.host ?? "invalid"}`).hostname;
    if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) throw new HttpError(403, "invalid_host");
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
    if (request.method === "GET" && pathname === "/health") return false;
    if (request.method === "GET" && pathname === "/session") {
      if (!origin) throw new HttpError(403, "origin_required");
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ token }));
      return true;
    }
    const actual = Buffer.from(request.headers.authorization ?? "");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new HttpError(401, "unauthorized");
    return false;
  };
}

export function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const limit = 1_048_576;
  if (Number(request.headers["content-length"] ?? 0) > limit) {
    request.resume();
    return Promise.reject(new HttpError(413, "request_too_large"));
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let exceeded = false;
    request.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > limit) {
        if (!exceeded) { exceeded = true; chunks.length = 0; reject(new HttpError(413, "request_too_large")); }
      } else if (!exceeded) chunks.push(chunk);
    });
    request.on("error", reject);
    request.on("end", () => {
      if (exceeded) return;
      try {
        const text = Buffer.concat(chunks).toString("utf8").trim();
        const value: unknown = text ? JSON.parse(text) : {};
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected object");
        resolve(value as Record<string, unknown>);
      } catch { reject(new HttpError(400, "invalid_json")); }
    });
  });
}
