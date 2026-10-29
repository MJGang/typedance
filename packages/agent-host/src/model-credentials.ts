import { z } from "zod";
import { requireLocalToken } from "./local-access";

/** The desktop owns credential storage; the Host never persists secret material. */
export interface ModelCredentialStore {
  get(): Promise<string | undefined>;
  set(value: string): Promise<void>;
  clear(): Promise<void>;
}

export function createHttpModelCredentialStore(options: { url: string; token: string; fetch?: typeof fetch }): ModelCredentialStore {
  let endpoint: URL;
  try {
    endpoint = new URL(options.url);
    if (endpoint.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(endpoint.hostname)
      || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/") throw new Error();
  } catch { throw new Error("A loopback desktop credential broker URL is required"); }
  const token = requireLocalToken(options.token);
  const fetchImpl = options.fetch ?? fetch;
  const url = new URL("/secrets/model-api-key", endpoint);
  const failure = () => new Error("系统安全存储不可用，请重启客户端后重试。");
  async function request(method: string, value?: string): Promise<unknown> {
    try {
      const response = await fetchImpl(url, {
        method, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
        headers: { authorization: `Bearer ${token}`, ...(method === "PUT" ? { "content-type": "application/json" } : {}) },
        ...(method === "PUT" ? { body: JSON.stringify({ value }) } : {}),
      });
      if (!response.ok) throw failure();
      return await response.json();
    } catch { throw failure(); }
  }
  return {
    async get() {
      const result = z.object({ value: z.string().min(1).max(4096).nullable() }).safeParse(await request("GET"));
      if (!result.success) throw failure();
      return result.data.value ?? undefined;
    },
    async set(value) { await request("PUT", value); },
    async clear() { await request("DELETE"); },
  };
}
