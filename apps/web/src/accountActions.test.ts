import { beforeEach, describe, expect, it, vi } from "vitest"
import { captureAccountSession } from "./accountSession"
import { applyAccountState, getAccountView, setAccountAction, type AccountState } from "./accountState"
import { finishAccountLock, finishAccountUpdate, importLocalAccountData, prepareAccountUpdate, signInAccount, signOutAccount } from "./accountActions"
import { testAccountSession } from "./test/accountFixture"

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), flush: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }))
vi.mock("./features/revision/useSourceCanvasAutosave", () => ({ flushAllSourceCanvasSaves: mocks.flush, retryAllSourceCanvasSaves: mocks.flush }))

function state(status: AccountState["status"] = "ready"): AccountState {
  return {
    revision: getAccountView().state.revision + 1, status, configured: true, providers: ["github"],
    user: { id: "owner-A", name: "账号 A" },
    session: status === "ready" || status === "locking" ? testAccountSession("A") : null,
    error: null, legacy: null,
  }
}

beforeEach(() => {
  mocks.invoke.mockReset()
  mocks.flush.mockReset().mockResolvedValue(true)
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })))
  setAccountAction("idle")
  applyAccountState(state())
})

describe("safe account transitions", () => {
  it("locks account actions during installation even without an active workspace", async () => {
    applyAccountState(state("signed_out"))
    expect(await prepareAccountUpdate()).toBe(true)
    expect(getAccountView().phase).toBe("switching")
    await signInAccount("github")
    expect(mocks.invoke).not.toHaveBeenCalled()
    expect(mocks.flush).not.toHaveBeenCalled()
    await finishAccountUpdate()
    expect(getAccountView().phase).toBe("idle")
  })

  it("cancels an in-flight sign-in and waits for its callback cleanup before installing", async () => {
    applyAccountState(state("signed_out"))
    let finishLogin!: (value: AccountState) => void
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "sign_in_account") {
        applyAccountState(state("signing_in"))
        return new Promise<AccountState>(resolve => { finishLogin = resolve })
      }
      if (command === "cancel_account_sign_in") return Promise.resolve(state("signing_in"))
      throw new Error(`unexpected command: ${command}`)
    })
    const login = signInAccount("github")
    const preparing = prepareAccountUpdate()
    let prepared = false
    void preparing.then(() => { prepared = true })
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("cancel_account_sign_in"))
    expect(prepared).toBe(false)
    await signInAccount("github")
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "sign_in_account")).toHaveLength(1)
    finishLogin(state("signed_out"))
    await login
    expect(await preparing).toBe(true)
    expect(getAccountView().phase).toBe("switching")
    await finishAccountUpdate()
  })

  it("finishes an existing data import and saves its workspace before installing", async () => {
    applyAccountState({ ...state("needs_import"), legacy: { import_started: false, sources: [{ id: "source", path: "C:/fixture", file_count: 1 }] } })
    let finishImport!: (value: AccountState) => void
    mocks.invoke.mockImplementation(() => new Promise<AccountState>(resolve => { finishImport = resolve }))
    const importing = importLocalAccountData("source")
    const preparing = prepareAccountUpdate()
    expect(mocks.flush).not.toHaveBeenCalled()
    expect(mocks.invoke).toHaveBeenCalledWith("import_local_account_data", { source: "source" })
    finishImport(state("ready"))
    await importing
    expect(await preparing).toBe(true)
    expect(mocks.flush).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/account/pause"), expect.anything())
    await finishAccountUpdate()
  })

  it("preserves unsaved content and releases the update guard when preparation fails", async () => {
    const captured = captureAccountSession()
    mocks.flush.mockResolvedValue(false)
    expect(await prepareAccountUpdate()).toBe(false)
    expect(getAccountView().phase).toBe("idle")
    expect(captureAccountSession()).toBe(captured)
    expect(captured.activitySignal.aborted).toBe(false)
    mocks.flush.mockResolvedValue(true)
    expect(await prepareAccountUpdate()).toBe(true)
    await finishAccountUpdate()
  })

  it("excludes account changes while an update owns the pause and save gate", async () => {
    let finishSave!: (success: boolean) => void
    mocks.flush.mockImplementation(() => new Promise<boolean>((resolve) => { finishSave = resolve }))
    const preparing = prepareAccountUpdate()
    await vi.waitFor(() => expect(finishSave).toBeTypeOf("function"))
    await signOutAccount()
    expect(mocks.invoke).not.toHaveBeenCalled()
    finishSave(true)
    expect(await preparing).toBe(true)
    await signInAccount("github")
    expect(mocks.invoke).not.toHaveBeenCalled()
    await finishAccountUpdate()
    expect(getAccountView().phase).toBe("idle")
    expect(fetch).toHaveBeenLastCalledWith(expect.stringContaining("/account/resume"), expect.anything())
    expect(captureAccountSession().activitySignal.aborted).toBe(false)
  })
  it("preserves the current workspace and capability when pending saves fail", async () => {
    mocks.flush.mockResolvedValue(false)
    const oldSession = captureAccountSession()
    await signOutAccount()
    expect(mocks.invoke).not.toHaveBeenCalled()
    expect(captureAccountSession()).toBe(oldSession)
    expect(getAccountView().state.status).toBe("ready")
    expect(getAccountView().actionError).toContain("有内容尚未保存")
  })

  it("pauses AI writes, waits for all saves before invoking sign-out and coalesces repeated clicks", async () => {
    let finishSave!: (success: boolean) => void
    mocks.flush.mockImplementation(() => new Promise<boolean>((resolve) => { finishSave = resolve }))
    mocks.invoke.mockImplementation(async () => state("signed_out"))
    const first = signOutAccount()
    const second = signOutAccount()
    expect(getAccountView().phase).toBe("saving")
    expect(captureAccountSession().session.id).toBe("A")
    expect(mocks.invoke).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(finishSave).toBeTypeOf("function"))
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/account/pause"), expect.objectContaining({ method: "POST" }))
    finishSave(true)
    await Promise.all([first, second])
    expect(mocks.flush).toHaveBeenCalledTimes(1)
    expect(mocks.invoke).toHaveBeenCalledTimes(1)
    expect(mocks.invoke).toHaveBeenCalledWith("sign_out_account", undefined)
    expect(getAccountView().state.status).toBe("signed_out")
    expect(() => captureAccountSession()).toThrow("账号会话已结束")
  })

  it("fails closed if a transition and the authoritative state refresh both fail", async () => {
    mocks.invoke.mockRejectedValue(new Error("service unavailable"))
    await signInAccount()
    expect(getAccountView().state.status).toBe("error")
    expect(getAccountView().state.session).toBeNull()
    expect(getAccountView().actionError).toContain("工作区已锁定")
    expect(() => captureAccountSession()).toThrow()
  })

  it("keeps expired-session drafts available for retry and prevents account switching", async () => {
    applyAccountState(state("locking"))
    mocks.flush.mockResolvedValue(false)
    await finishAccountLock()
    expect(getAccountView().state.status).toBe("locking")
    expect(captureAccountSession().session.id).toBe("A")
    await signInAccount("github")
    await signOutAccount()
    expect(mocks.invoke).not.toHaveBeenCalled()
    expect(getAccountView().state.status).toBe("locking")
  })

  it("only finishes an expiry lock after pending saves succeed", async () => {
    applyAccountState(state("locking"))
    mocks.invoke.mockImplementation(async () => {
      expect(mocks.flush).toHaveBeenCalledTimes(1)
      return state("locked")
    })
    await finishAccountLock()
    expect(mocks.invoke).toHaveBeenCalledWith("finish_account_lock")
    expect(getAccountView().state.status).toBe("locked")
    expect(() => captureAccountSession()).toThrow()
  })
})
