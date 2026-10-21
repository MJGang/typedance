import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

beforeEach(() => { vi.resetModules() })
afterEach(() => { vi.unstubAllGlobals() })

describe("authenticated Agent Host requests", () => {
  it("shares one bootstrap and sends bearer headers without putting tokens in URLs", async () => {
    const token = "one-process-token-01234567890123456789"
    const fetchMock = vi.fn(async (input: string) => input.endsWith("/session") ? Response.json({ token }) : Response.json([]))
    vi.stubGlobal("fetch", fetchMock)
    const { listWorkspaceConversations } = await import("./agentHost")
    await Promise.all([listWorkspaceConversations("one"), listWorkspaceConversations("two")])
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/session"))).toHaveLength(1)
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>
    for (const [url, init] of calls.filter(([url]) => !url.endsWith("/session"))) {
      expect(url).not.toContain(token)
      expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${token}`)
    }
  })

  it("renews the session when the host restarts and rejects an old token", async () => {
    let bootstraps = 0; let requests = 0
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/session")) return Response.json({ token: `process-${++bootstraps}-token-01234567890123456789` })
      return ++requests === 1 ? new Response(null, { status: 401 }) : Response.json([])
    })
    vi.stubGlobal("fetch", fetchMock)
    const { listWorkspaceConversations } = await import("./agentHost")
    await expect(listWorkspaceConversations("one")).resolves.toEqual([])
    expect(bootstraps).toBe(2); expect(requests).toBe(2)
  })
});
