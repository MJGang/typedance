import { afterEach, describe, expect, it, vi } from "vitest"

const windowApi = vi.hoisted(() => ({
  close: vi.fn(),
  minimize: vi.fn(),
  startDragging: vi.fn(),
  toggleMaximize: vi.fn(),
}))

const getCurrentWindow = vi.hoisted(() => vi.fn(() => windowApi))

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow }))

import {
  closeDesktopWindow,
  minimizeDesktopWindow,
  startDraggingDesktopWindow,
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
    ["startDragging", startDraggingDesktopWindow],
  ] as const)("calls %s in Tauri", async (method, action) => {
    window.__TAURI_INTERNALS__ = { invoke: vi.fn() }

    await action()

    expect(getCurrentWindow).toHaveBeenCalledOnce()
    expect(windowApi[method]).toHaveBeenCalledOnce()
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
