import { afterEach, describe, expect, it, vi } from "vitest"

const windowApi = vi.hoisted(() => ({
  close: vi.fn(),
  isMaximized: vi.fn<() => Promise<boolean>>(),
  minimize: vi.fn(),
  onResized: vi.fn<(handler: () => void) => Promise<() => void>>(),
  startDragging: vi.fn(),
  toggleMaximize: vi.fn(),
}))

const getCurrentWindow = vi.hoisted(() => vi.fn(() => windowApi))

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow }))

import {
  closeDesktopWindow,
  minimizeDesktopWindow,
  subscribeDesktopWindowMaximized,
  toggleMaximizeDesktopWindow,
} from "./desktopWindow"

describe("desktop window controls", () => {
  afterEach(() => {
    vi.clearAllMocks()
    delete window.__TAURI_INTERNALS__
  })

  it("does not call desktop APIs outside Tauri", async () => {
    await minimizeDesktopWindow()

    expect(getCurrentWindow).not.toHaveBeenCalled()
  })

  it.each([
    ["minimize", minimizeDesktopWindow],
    ["toggleMaximize", toggleMaximizeDesktopWindow],
  ] as const)("calls %s in Tauri", async (method, action) => {
    window.__TAURI_INTERNALS__ = { invoke: vi.fn() }

    await action()

    expect(getCurrentWindow).toHaveBeenCalledOnce()
    expect(windowApi[method]).toHaveBeenCalledOnce()
  })

  it("subscribes to resize events and reports the current maximized state", async () => {
    window.__TAURI_INTERNALS__ = { invoke: vi.fn() }
    const unlisten = vi.fn()
    const listener = vi.fn()
    windowApi.onResized.mockResolvedValue(unlisten)
    windowApi.isMaximized.mockResolvedValueOnce(true).mockResolvedValueOnce(false)

    const unsubscribe = await subscribeDesktopWindowMaximized(listener)

    expect(windowApi.onResized).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith(true)

    windowApi.onResized.mock.calls[0][0]()
    await vi.waitFor(() => expect(listener).toHaveBeenLastCalledWith(false))

    unsubscribe()
    expect(unlisten).toHaveBeenCalledOnce()
  })

  it("requests a managed application shutdown in Tauri", async () => {
    const invoke = vi.fn()
    window.__TAURI_INTERNALS__ = { invoke }

    await closeDesktopWindow()

    expect(invoke).toHaveBeenCalledWith("shutdown_application")
    expect(getCurrentWindow).not.toHaveBeenCalled()
    expect(windowApi.close).not.toHaveBeenCalled()
  })
})
