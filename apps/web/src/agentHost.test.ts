import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { installTestAccountSession, testAccountSession } from "./test/accountFixture"

beforeEach(async () => { vi.resetModules(); await installTestAccountSession() })
afterEach(() => { vi.unstubAllGlobals() })

describe("authenticated Agent Host requests", () => {
  it("notifies the model display after either settings entry saves successfully", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/session")) return Response.json({ token: "test-process-token-01234567890123456789" })
      if (url.endsWith("/selection")) return Response.json({ model: "deepseek-v4-pro", reasoning_effort: "low", models: [] })
      return Response.json({ provider: "deepseek", model: "deepseek-v4-pro", base_url: "https://api.deepseek.com", api_key: { configured: true, preview: "...test" } })
    })
    vi.stubGlobal("fetch", fetchMock)
    const { subscribeModelSettings } = await import("./modelSettingsEvents")
    const changed = vi.fn()
    const unsubscribe = subscribeModelSettings(changed)
    try {
      const { updateModelSettings, updateModelSelection } = await import("./agentHost")
      await updateModelSettings({ model: "deepseek-v4-pro", base_url: "https://api.deepseek.com" })
      await updateModelSelection({ model: "deepseek-v4-pro", reasoning_effort: "low" })
      expect(changed).toHaveBeenCalledTimes(2)
    } finally { unsubscribe() }
  })
  it("lets the Host resolve the current model when sending a conversation run", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => url.endsWith("/session")
      ? Response.json({ token: "test-process-token-01234567890123456789" })
      : Response.json({ id: "run", conversation_id: "conversation", status: "running", model: "deepseek-v4-pro", mutation_mode: "review", started_at: "2026-10-25T00:00:00Z" }))
    vi.stubGlobal("fetch", fetchMock)
    const { startConversationRun } = await import("./agentHost")
    await startConversationRun({ workspaceId: "doc", conversationId: "conversation", content: "hello" })
    const call = fetchMock.mock.calls.find(([url]) => url.endsWith("/runs"))
    expect(JSON.parse(String(call?.[1]?.body))).not.toHaveProperty("model")
  })
  it("uses the verified desktop capability without bootstrapping or putting tokens in URLs", async () => {
    const token = testAccountSession().token
    const fetchMock = vi.fn(async (_input: string) => Response.json([]))
    vi.stubGlobal("fetch", fetchMock)
    const { listWorkspaceConversations } = await import("./agentHost")
    await Promise.all([listWorkspaceConversations("one"), listWorkspaceConversations("two")])
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/session"))).toHaveLength(0)
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>
    for (const [url, init] of calls.filter(([url]) => !url.endsWith("/session"))) {
      expect(url).not.toContain(token)
      expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${token}`)
    }
  })

  it("rejects an expired capability without fetching or replaying with a new account token", async () => {
    let bootstraps = 0; let requests = 0
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/session")) return Response.json({ token: `process-${++bootstraps}-token-01234567890123456789` })
      return ++requests === 1 ? new Response(null, { status: 401 }) : Response.json([])
    })
    vi.stubGlobal("fetch", fetchMock)
    const { listWorkspaceConversations } = await import("./agentHost")
    await expect(listWorkspaceConversations("one")).rejects.toThrow("401")
    expect(bootstraps).toBe(0); expect(requests).toBe(1)
  })
});
