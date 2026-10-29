import { once } from "node:events";
import { request } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createHarnessRuntime } from "@typedance/harness-core";
import { createAgentHost, createAgentHostServer, type AgentHostHttpServer } from "../src";

let server: AgentHostHttpServer;
const token = "desktop-issued-account-token-0123456789";
afterEach(async () => { await server?.close(); });
async function start() {
  server = createAgentHostServer({ authToken: token, host: createAgentHost({ runtime: createHarnessRuntime(), packs: [] }) });
  server.listen(); await once(server.nodeServer, "listening");
  return server.url;
}

describe("local service access", () => {
  it("only accepts desktop-issued capabilities and never publishes a bootstrap token", async () => {
    const url = await start();
    expect((await fetch(`${url}/health`)).status).toBe(401);
    expect((await fetch(`${url}/session`)).status).toBe(401);
    expect((await fetch(`${url}/session`, { headers: { origin: "https://untrusted.example" } })).status).toBe(403);
    expect((await fetch(`${url}/workspaces/ws/conversations`)).status).toBe(401);
    const session = await fetch(`${url}/session`, { headers: { authorization: `Bearer ${token}`, origin: "http://tauri.localhost" } });
    expect(session.headers.get("access-control-allow-origin")).toBe("http://tauri.localhost");
    expect(session.headers.get("cache-control")).toBe("no-store");
    expect(session.status).toBe(404);
    expect(await session.text()).not.toContain(token);
    const headers = { authorization: `Bearer ${token}` };
    expect((await fetch(`${url}/health`, { headers })).status).toBe(200);
    expect((await fetch(`${url}/workspaces/ws/conversations`, { headers })).status).toBe(200);
    expect((await fetch(`${url}/workspaces/ws/conversations`, { headers: { ...headers, origin: "https://untrusted.example" } })).status).toBe(403);
    expect((await fetch(`${url}/workspaces/ws/conversations`, { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
  });

  it("rejects oversized bodies and malformed JSON before mutating data", async () => {
    const url = await start();
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    expect((await fetch(`${url}/workspaces/ws/conversations`, { method: "POST", headers, body: "x".repeat(8_388_609) })).status).toBe(413);
    expect((await fetch(`${url}/workspaces/ws/conversations`, { method: "POST", headers, body: "{" })).status).toBe(400);
    expect(await fetch(`${url}/workspaces/ws/conversations`, { headers }).then((r) => r.json())).toEqual([]);
  });

  it("rejects rebinding hosts and duplicate security headers even with the right token", async () => {
    const url = await start();
    const status = (headers: string[]) => new Promise<number>((resolve, reject) => {
      request(`${url}/health`, { headers }, (response) => { response.resume(); resolve(response.statusCode!); }).on("error", reject).end();
    });
    const host = new URL(url).host;
    expect(await status(["Host", "attacker.example", "Authorization", `Bearer ${token}`])).toBe(403);
    expect(await status(["Host", host, "Authorization", `Bearer ${token}`, "Authorization", `Bearer ${token}`])).toBe(401);
    expect(await status(["Host", host, "Authorization", `Bearer ${token}`, "Origin", "http://tauri.localhost", "Origin", "https://attacker.example"])).toBe(403);
    expect(await status(["Host", host, "Host", "attacker.example", "Authorization", `Bearer ${token}`])).toBe(403);
  });

  it("requires an explicit valid capability at construction", () => {
    expect(() => createAgentHostServer({ authToken: "", host: createAgentHost({ runtime: createHarnessRuntime(), packs: [] }) })).toThrow("desktop-issued");
  });

  it("rejects malformed request targets without terminating the account service", async () => {
    const url = new URL(await start());
    const status = await new Promise<number>((resolve, reject) => {
      request({ hostname: url.hostname, port: url.port, path: "http://[", headers: { authorization: `Bearer ${token}` } }, (response) => {
        response.resume(); resolve(response.statusCode!);
      }).on("error", reject).end();
    });
    expect(status).toBe(400);
    expect((await fetch(new URL("/health", url), { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
  });
});
