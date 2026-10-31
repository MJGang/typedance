import { afterEach, describe, expect, it, vi } from "vitest"
import { createClientUpdater, type ClientUpdateSnapshot } from "./client-updater"

const initial: ClientUpdateSnapshot = {
  revision: 0, phase: "idle", currentVersion: "0.1.0", releasesUrl: null, update: null,
  downloadedBytes: 0, totalBytes: null, lastCheckedAt: null, error: null,
}
const available: ClientUpdateSnapshot = {
  ...initial, revision: 2, phase: "available", lastCheckedAt: 123,
  update: { version: "0.1.1", notes: "- 更新说明", publishedAt: null },
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function setup(options: { supported?: boolean; autoCheck?: string; context?: "restoring" | "login" | "workspace" } = {}) {
  let emit!: (state: ClientUpdateSnapshot) => void
  let accountChanged!: () => void
  let context = options.context ?? "workspace"
  const invoke = vi.fn(async (command: string): Promise<unknown> => command === "get_client_update_state" ? initial : available)
  const storage = { getItem: vi.fn(() => options.autoCheck ?? null), setItem: vi.fn() }
  const listen = vi.fn(async (callback: (state: ClientUpdateSnapshot) => void) => { emit = callback; return vi.fn() })
  const prepareInstall = vi.fn(async () => true)
  const subscribeAccount = vi.fn((listener: () => void) => { accountChanged = listener; return vi.fn() })
  const updater = createClientUpdater({
    supported: options.supported ?? true, storage, listen, prepareInstall, finishInstall: async () => {},
    invoke: <T,>(command: string) => invoke(command) as Promise<T>,
    getAccountContext: () => context, subscribeAccount,
  })
  return { updater, invoke, storage, listen, prepareInstall, subscribeAccount,
    emit: (state: ClientUpdateSnapshot) => emit(state),
    setContext(next: typeof context) { context = next; accountChanged() },
  }
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe("client updater lifecycle", () => {
  it("never calls native installation when the final save gate fails", async () => {
    const { updater, invoke, prepareInstall } = setup({ autoCheck: "false" })
    prepareInstall.mockResolvedValue(false)
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      await updater.install()
      expect(prepareInstall).toHaveBeenCalledTimes(1)
      expect(invoke).not.toHaveBeenCalledWith("install_client_update")
      expect(updater.getSnapshot()).toMatchObject({ phase: "error", error: "prepare" })
    } finally { log.mockRestore() }
  })
  it("initializes the native listener and automatic check once across repeated mounts", async () => {
    const { updater, invoke, listen } = setup()
    await Promise.all([updater.start(), updater.start()])
    expect(listen).toHaveBeenCalledTimes(1)
    expect(invoke.mock.calls.map(([command]) => command)).toEqual(["get_client_update_state", "check_client_update"])
    expect(updater.getSnapshot().phase).toBe("available")
  })

  it("honors a saved opt-out while allowing manual checks", async () => {
    const { updater, invoke, storage } = setup({ autoCheck: "false" })
    await updater.start()
    expect(invoke).not.toHaveBeenCalledWith("check_client_update")
    await updater.check()
    expect(invoke).toHaveBeenCalledWith("check_client_update")
    updater.setAutoCheck(true)
    expect(storage.setItem).toHaveBeenCalledWith("typedance.client-updates.auto-check", "true")
  })

  it("keeps a newer progress event when an older IPC response arrives later", async () => {
    const { updater, invoke, emit } = setup({ autoCheck: "false" })
    await updater.start()
    const response = deferred<ClientUpdateSnapshot>()
    invoke.mockImplementationOnce(() => response.promise)
    const pending = updater.check()
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("check_client_update"))
    emit({ ...available, phase: "downloading", revision: 7, downloadedBytes: 62, totalBytes: 100 })
    response.resolve(available)
    await pending
    expect(updater.getSnapshot()).toMatchObject({ phase: "downloading", revision: 7, downloadedBytes: 62 })
  })

  it("keeps downloading without subscribers and allows cancellation while the operation is pending", async () => {
    const { updater, invoke, emit } = setup()
    await updater.start()
    const download = deferred<ClientUpdateSnapshot>()
    invoke.mockImplementation((command) => command === "download_client_update" ? download.promise : Promise.resolve(undefined))
    const listener = vi.fn()
    const unsubscribe = updater.subscribe(listener)
    const pending = updater.download()
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("download_client_update"))
    unsubscribe()
    emit({ ...available, revision: 4, phase: "downloading", downloadedBytes: 50 })
    expect(updater.getSnapshot().downloadedBytes).toBe(50)
    expect(listener).not.toHaveBeenCalled()
    await updater.cancel()
    expect(invoke).toHaveBeenCalledWith("cancel_client_update")
    download.resolve({ ...available, revision: 5 })
    await pending
    expect(updater.getSnapshot().phase).toBe("available")
  })

  it("never performs native update operations in a browser", async () => {
    const { updater, invoke, listen } = setup({ supported: false })
    await updater.start()
    await updater.check()
    await updater.download()
    await updater.install()
    expect(invoke).not.toHaveBeenCalled()
    expect(listen).not.toHaveBeenCalled()
    expect(updater.getSnapshot().update).toBeNull()
  })

  it("deduplicates simultaneous checks rather than dispatching conflicting operations", async () => {
    const { updater, invoke } = setup({ autoCheck: "false" })
    await updater.start()
    const result = deferred<ClientUpdateSnapshot>()
    invoke.mockImplementation(() => result.promise)
    const checks = [updater.check(), updater.check()]
    await vi.waitFor(() => expect(invoke.mock.calls.filter(([command]) => command === "check_client_update")).toHaveLength(1))
    result.resolve(available)
    await Promise.all(checks)
  })
})

const ready: ClientUpdateSnapshot = { ...available, revision: 4, phase: "ready", downloadedBytes: 100, totalBytes: 100 }
const installing: ClientUpdateSnapshot = { ...ready, revision: 5, phase: "installing" }

function successfulUpdates(command: string): Promise<ClientUpdateSnapshot> {
  return Promise.resolve(command === "get_client_update_state" ? initial
    : command === "check_client_update" ? available
      : command === "download_client_update" ? ready : installing)
}

describe("automatic updates before login", () => {
  it("releases automatic ownership after a no-update result so later workspace checks remain manual", async () => {
    const { updater, invoke, setContext } = setup({ context: "login" })
    invoke.mockImplementation(command => Promise.resolve(command === "get_client_update_state" ? initial : { ...available, phase: "latest", update: null }))
    await updater.start()
    expect(updater.getSnapshot()).toMatchObject({ phase: "latest", automatic: false })
    setContext("workspace")
    invoke.mockResolvedValue({ ...available, revision: 3 })
    await updater.check()
    expect(updater.getSnapshot()).toMatchObject({ phase: "available", automatic: false })
    expect(invoke).not.toHaveBeenCalledWith("download_client_update")
    expect(invoke).not.toHaveBeenCalledWith("install_client_update")
    invoke.mockImplementation(successfulUpdates)
    setContext("login")
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("install_client_update"))
    expect(invoke.mock.calls.filter(([command]) => command === "download_client_update")).toHaveLength(1)
  })

  it("checks, downloads and installs once without user actions even when workspace checks are disabled", async () => {
    const { updater, invoke, prepareInstall, listen, subscribeAccount } = setup({ context: "login", autoCheck: "false" })
    invoke.mockImplementation(successfulUpdates)
    await Promise.all([updater.start(), updater.start()])
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "get_client_update_state", "check_client_update", "download_client_update", "install_client_update",
    ])
    expect(prepareInstall).toHaveBeenCalledOnce()
    expect(listen).toHaveBeenCalledOnce()
    expect(subscribeAccount).toHaveBeenCalledOnce()
    expect(updater.getSnapshot()).toMatchObject({ automatic: true, phase: "installing" })
  })

  it("waits for account restoration and does not automatically install in a restored workspace", async () => {
    const { updater, invoke, setContext } = setup({ context: "restoring" })
    invoke.mockImplementation(successfulUpdates)
    await updater.start()
    expect(invoke.mock.calls.map(([command]) => command)).toEqual(["get_client_update_state"])
    setContext("workspace")
    await vi.waitFor(() => expect(updater.getSnapshot().phase).toBe("available"))
    expect(invoke.mock.calls.map(([command]) => command)).toEqual(["get_client_update_state", "check_client_update"])
    setContext("login")
    setContext("login")
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("install_client_update"))
    expect(invoke.mock.calls.filter(([command]) => command === "download_client_update")).toHaveLength(1)
  })

  it("finishes the same update after sign-in and after login subscribers unmount", async () => {
    const { updater, invoke, setContext, emit } = setup({ context: "login" })
    const download = deferred<ClientUpdateSnapshot>()
    invoke.mockImplementation(command => command === "download_client_update" ? download.promise : successfulUpdates(command))
    const unsubscribe = updater.subscribe(vi.fn())
    const pending = updater.start()
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("download_client_update"))
    emit({ ...available, revision: 3, phase: "downloading", downloadedBytes: 64, totalBytes: 100 })
    unsubscribe()
    setContext("workspace")
    expect(updater.getSnapshot().downloadedBytes).toBe(64)
    download.resolve(ready)
    await pending
    expect(invoke.mock.calls.filter(([command]) => command === "install_client_update")).toHaveLength(1)
  })

  it("retries a failed download with backoff and never installs unverified or incomplete bytes", async () => {
    vi.useFakeTimers()
    const { updater, invoke } = setup({ context: "login" })
    let downloads = 0
    invoke.mockImplementation(command => command === "download_client_update" && downloads++ === 0
      ? Promise.resolve({ ...available, revision: 3, phase: "error", error: "download" }) : successfulUpdates(command))
    const pending = updater.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(updater.getSnapshot()).toMatchObject({ phase: "error", retrying: true })
    expect(invoke).not.toHaveBeenCalledWith("install_client_update")
    await vi.advanceTimersByTimeAsync(9_999)
    expect(downloads).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    await pending
    expect(downloads).toBe(2)
    expect(invoke).toHaveBeenCalledWith("install_client_update")
  })

  it("stops after bounded download failures and never invokes the installer", async () => {
    vi.useFakeTimers()
    const { updater, invoke } = setup({ context: "login" })
    let revision = 3
    invoke.mockImplementation(command => command === "download_client_update"
      ? Promise.resolve({ ...available, revision: revision++, phase: "error", error: "download" }) : successfulUpdates(command))
    const pending = updater.start()
    await vi.runAllTimersAsync()
    await pending
    expect(invoke.mock.calls.filter(([command]) => command === "download_client_update")).toHaveLength(4)
    expect(invoke).not.toHaveBeenCalledWith("install_client_update")
    expect(updater.getSnapshot()).toMatchObject({ phase: "error", retrying: false })
  })

  it("does not invoke the installer when preparation fails", async () => {
    const { updater, invoke, prepareInstall } = setup({ context: "login" })
    invoke.mockImplementation(successfulUpdates)
    prepareInstall.mockResolvedValue(false)
    vi.spyOn(console, "error").mockImplementation(() => {})
    await updater.start()
    await updater.start()
    expect(prepareInstall).toHaveBeenCalledOnce()
    expect(invoke).not.toHaveBeenCalledWith("install_client_update")
    expect(updater.getSnapshot()).toMatchObject({ phase: "error", error: "prepare" })
  })

  it("does not automatically reopen a failed or canceled installer", async () => {
    const { updater, invoke, setContext } = setup({ context: "login" })
    invoke.mockImplementation(command => command === "install_client_update"
      ? Promise.resolve({ ...ready, revision: 5, phase: "error", error: "install" }) : successfulUpdates(command))
    await updater.start()
    await updater.start()
    setContext("login")
    setContext("login")
    expect(invoke.mock.calls.filter(([command]) => command === "install_client_update")).toHaveLength(1)
    expect(updater.getSnapshot()).toMatchObject({ phase: "error", error: "install", automatic: false })
  })
})
