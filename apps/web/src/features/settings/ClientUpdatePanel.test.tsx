import "@testing-library/jest-dom/vitest"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ClientUpdatePanel } from "./ClientUpdatePanel"

const mocks = vi.hoisted(() => ({
  state: {
    phase: "available", revision: 2, currentVersion: "0.1.0", supported: true,
    releasesUrl: "https://example.com/releases" as string | null,
    update: { version: "0.1.1", notes: "- 优化编辑体验", publishedAt: null },
    downloadedBytes: 0, totalBytes: null as number | null, lastCheckedAt: null,
    error: null as string | null, autoCheck: true, preferenceError: false,
  },
  check: vi.fn(), download: vi.fn(), install: vi.fn(), cancel: vi.fn(), openReleaseNotes: vi.fn(), setAutoCheck: vi.fn(), flush: vi.fn(),
}))
vi.mock("./useClientUpdater", () => ({ useClientUpdater: () => mocks.state }))
vi.mock("./client-updater", () => ({ clientUpdater: mocks }))
vi.mock("@/features/revision/useSourceCanvasAutosave", () => ({ flushAllSourceCanvasSaves: () => mocks.flush() }))

describe("client update settings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(mocks.state, { phase: "available", error: null, supported: true, releasesUrl: "https://example.com/releases", downloadedBytes: 0, totalBytes: null })
    mocks.flush.mockResolvedValue(true)
    mocks.cancel.mockResolvedValue(true)
    mocks.openReleaseNotes.mockResolvedValue(true)
  })

  it("shows real release notes and starts download only on user action", () => {
    const dismiss = vi.fn()
    render(<ClientUpdatePanel onDismiss={dismiss} />)
    expect(screen.getByText("优化编辑体验")).toBeInTheDocument()
    expect(mocks.download).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "下载更新" }))
    expect(mocks.download).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole("button", { name: "稍后" }))
    expect(dismiss).toHaveBeenCalledTimes(1)
  })

  it("shows byte-based progress and cancellation without inventing a percentage for unknown sizes", () => {
    Object.assign(mocks.state, { phase: "downloading", downloadedBytes: 62, totalBytes: 100 })
    const { rerender } = render(<ClientUpdatePanel onDismiss={vi.fn()} />)
    expect(screen.getByText("62%")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "取消下载" }))
    expect(mocks.cancel).toHaveBeenCalledTimes(1)
    mocks.state.totalBytes = null
    rerender(<ClientUpdatePanel onDismiss={vi.fn()} />)
    expect(screen.queryByText("62%")).not.toBeInTheDocument()
    expect(screen.getByText(/大小未知/)).toBeInTheDocument()
  })

  it("requires confirmation and waits for pending canvas saves before installing", async () => {
    mocks.state.phase = "ready"
    let finishSave!: (saved: boolean) => void
    mocks.flush.mockImplementation(() => new Promise<boolean>((resolve) => { finishSave = resolve }))
    render(<ClientUpdatePanel onDismiss={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "重启并更新" }))
    expect(mocks.install).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "确认重启" }))
    await waitFor(() => expect(mocks.flush).toHaveBeenCalledTimes(1))
    expect(mocks.install).not.toHaveBeenCalled()
    await act(async () => { finishSave(true) })
    await waitFor(() => expect(mocks.install).toHaveBeenCalledTimes(1))
  })

  it("blocks installation if saving fails", async () => {
    mocks.state.phase = "ready"
    mocks.flush.mockResolvedValue(false)
    render(<ClientUpdatePanel onDismiss={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "重启并更新" }))
    fireEvent.click(screen.getByRole("button", { name: "确认重启" }))
    await waitFor(() => expect(mocks.flush).toHaveBeenCalledTimes(1))
    expect(mocks.install).not.toHaveBeenCalled()
    expect(screen.getByRole("alertdialog")).toBeInTheDocument()
  })

  it("provides download retry and disables native actions in browser preview", () => {
    Object.assign(mocks.state, { phase: "error", error: "download" })
    const { rerender } = render(<ClientUpdatePanel onDismiss={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "重新下载" }))
    expect(mocks.download).toHaveBeenCalledTimes(1)
    mocks.state.supported = false
    rerender(<ClientUpdatePanel onDismiss={vi.fn()} />)
    expect(screen.getByText("请在桌面客户端中检查更新")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "检查更新" })).toBeDisabled()
  })

  it("explains an unconfigured update service instead of pretending the version is current", () => {
    Object.assign(mocks.state, { phase: "error", error: "unconfigured", releasesUrl: null })
    render(<ClientUpdatePanel onDismiss={vi.fn()} />)
    expect(screen.getByText("更新服务尚未配置")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "检查更新" })).toBeDisabled()
    expect(screen.queryByText("已是最新版本")).not.toBeInTheDocument()
  })
})
