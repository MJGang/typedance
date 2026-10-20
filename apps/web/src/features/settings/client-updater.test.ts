import { describe, expect, it, vi } from "vitest"
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

function setup(options: { supported?: boolean; autoCheck?: string } = {}) {
  let emit!: (state: ClientUpdateSnapshot) => void
  const invoke = vi.fn(async (command: string): Promise<unknown> => command === "get_client_update_state" ? initial : available)
  const storage = { getItem: vi.fn(() => options.autoCheck ?? null), setItem: vi.fn() }
  const listen = vi.fn(async (callback: (state: ClientUpdateSnapshot) => void) => { emit = callback; return vi.fn() })
  const updater = createClientUpdater({
    supported: options.supported ?? true, storage, listen,
    invoke: <T,>(command: string) => invoke(command) as Promise<T>,
  })
  return { updater, invoke, storage, listen, emit: (state: ClientUpdateSnapshot) => emit(state) }
}

describe("client updater lifecycle", () => {
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
