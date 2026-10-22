import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { createHarnessRuntime } from "@typedance/harness-core";
import { createAgentHost, createAgentHostServer, type AgentHostHttpServer } from "../src";

let server: AgentHostHttpServer;
afterEach(async () => { await server?.close(); });
async function start() {
  server = createAgentHostServer({ host: createAgentHost({ runtime: createHarnessRuntime(), packs: [] }) });
  server.listen(); await once(server.nodeServer, "listening");
  return server.url;
}

describe("local service access", () => {
  it("requires a trusted origin to bootstrap and a bearer token for business APIs", async () => {
    const url = await start();
    expect((await fetch(`${url}/health`)).status).toBe(200);
    expect((await fetch(`${url}/session`)).status).toBe(403);
    expect((await fetch(`${url}/session`, { headers: { origin: "https://untrusted.example" } })).status).toBe(403);
    expect((await fetch(`${url}/workspaces/ws/conversations`)).status).toBe(401);
    const session = await fetch(`${url}/session`, { headers: { origin: "http://tauri.localhost" } });
    expect(session.headers.get("access-control-allow-origin")).toBe("http://tauri.localhost");
    expect(session.headers.get("cache-control")).toBe("no-store");
    const { token } = await session.json();
    const headers = { authorization: `Bearer ${token}` };
    expect((await fetch(`${url}/workspaces/ws/conversations`, { headers })).status).toBe(200);
    expect((await fetch(`${url}/workspaces/ws/conversations`, { headers: { ...headers, origin: "https://untrusted.example" } })).status).toBe(403);
    expect((await fetch(`${url}/workspaces/ws/conversations`, { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
  });

  it("rejects oversized bodies and malformed JSON before mutating data", async () => {
    const url = await start();
    const { token } = await fetch(`${url}/session`, { headers: { origin: "http://127.0.0.1:5173" } }).then((r) => r.json());
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    expect((await fetch(`${url}/workspaces/ws/conversations`, { method: "POST", headers, body: "x".repeat(8_388_609) })).status).toBe(413);
    expect((await fetch(`${url}/workspaces/ws/conversations`, { method: "POST", headers, body: "{" })).status).toBe(400);
    expect(await fetch(`${url}/workspaces/ws/conversations`, { headers }).then((r) => r.json())).toEqual([]);
  });
});
