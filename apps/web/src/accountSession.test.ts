import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { accountObjectUrl, agentHostFetch, captureAccountSession, setAccountSaveOnly, setAccountSession, sidecarFetch, subscribeAccountActivitiesStopped } from "./accountSession"
import { testAccountSession } from "./test/accountFixture"

beforeEach(() => setAccountSession(testAccountSession("A")))
afterEach(() => { setAccountSession(null); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe("account-bound local transport", () => {
  it("does not contact shared service ports before login", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    setAccountSession(null)
    await expect(sidecarFetch("/documents")).rejects.toThrow("账号会话已结束")
    await expect(agentHostFetch("/settings/model")).rejects.toThrow("账号会话已结束")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("uses only the desktop-published endpoints and bearer capability", async () => {
    const session = { ...testAccountSession("A"), sidecar_url: "http://127.0.0.1:54321", agent_host_url: "http://127.0.0.1:54322" }
    setAccountSession(session)
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json([]))
    vi.stubGlobal("fetch", fetchMock)
    await (await sidecarFetch("/documents")).json()
    await (await agentHostFetch("/settings/model")).json()
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(["http://127.0.0.1:54321/documents", "http://127.0.0.1:54322/settings/model"])
    for (const [url, init] of fetchMock.mock.calls as unknown as Array<[string, RequestInit]>) {
      expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${session.token}`)
      expect(url).not.toContain(session.token)
      expect(init.redirect).toBe("error")
    }
  })

  it("rejects delayed A responses after B signs in, even if fetch ignores abort", async () => {
    let resolve!: (response: Response) => void
    const fetchMock = vi.fn((_url: string, _init: RequestInit) => new Promise<Response>((done) => { resolve = done }))
    vi.stubGlobal("fetch", fetchMock)
    const oldRequest = sidecarFetch("/documents", { method: "POST" })
    setAccountSession(testAccountSession("B"))
    expect(fetchMock.mock.calls[0][1].signal?.aborted).toBe(true)
    resolve(Response.json({ id: "A-private-document" }))
    await expect(oldRequest).rejects.toThrow("账号会话已结束")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("rejects response bodies and clones belonging to an ended session", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ secret: "A" })))
    const response = await sidecarFetch("/documents")
    const clone = response.clone()
    setAccountSession(testAccountSession("B"))
    await expect(response.json()).rejects.toThrow("账号会话已结束")
    await expect(clone.json()).rejects.toThrow("账号会话已结束")
  })

  it("never bootstraps or replays a rejected write with another capability", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 401 }))
    vi.stubGlobal("fetch", fetchMock)
    expect((await agentHostFetch("/conversations/A", { method: "DELETE" })).status).toBe(401)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).not.toContain("/session")
  })

  it("allows pending canvas saves while locking and refuses other business operations", async () => {
    const fetchMock = vi.fn(async () => Response.json({}))
    vi.stubGlobal("fetch", fetchMock)
    setAccountSaveOnly(true)
    await (await sidecarFetch("/documents/A/source-resume-canvas", { method: "PUT" })).json()
    await expect(sidecarFetch("/documents", { method: "POST" })).rejects.toThrow("正在锁定")
    await expect(agentHostFetch("/settings/model")).rejects.toThrow("正在锁定")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("stops streams and microphone activities during expiry while preserving the save channel", () => {
    const session = captureAccountSession()
    const stop = vi.fn()
    const unsubscribe = subscribeAccountActivitiesStopped(stop)
    setAccountSaveOnly(true)
    expect(session.activitySignal.aborted).toBe(true)
    expect(session.signal.aborted).toBe(false)
    expect(stop).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it("invalidates an old operation even when the same account logs in again", async () => {
    const captured = captureAccountSession()
    setAccountSession(null)
    setAccountSession(testAccountSession("A"))
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    await expect(sidecarFetch("/documents/A", { method: "PATCH" }, captured)).rejects.toThrow("账号会话已结束")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("revokes authenticated PDF preview blobs when the account ends", () => {
    const create = vi.fn(() => "blob:private-A-preview")
    const revoke = vi.fn()
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }))
    const preview = accountObjectUrl(new Blob(["private pdf"]))
    expect(preview).toBe("blob:private-A-preview")
    setAccountSession(testAccountSession("B"))
    expect(revoke).toHaveBeenCalledWith(preview)
  })
})
