import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AccountUpdateFooter } from "./AccountUpdateFooter"
import type { ClientUpdateSnapshot } from "@/features/settings/client-updater"

const mock = vi.hoisted(() => ({ state: {} as ClientUpdateSnapshot & { supported: boolean; retrying: boolean } }))
vi.mock("@/features/settings/useClientUpdater", () => ({ useClientUpdater: () => mock.state }))
beforeEach(() => {
  mock.state = { revision: 1, phase: "checking", currentVersion: "0.1.18", releasesUrl: null,
    update: null, downloadedBytes: 0, totalBytes: null, lastCheckedAt: null, error: null, supported: true, retrying: false }
})
afterEach(cleanup)

describe("compact automatic update footer", () => {
  it("shows the version and indeterminate state without update actions", () => {
    render(<AccountUpdateFooter />)
    expect(screen.getByText("v0.1.18")).toBeVisible()
    expect(screen.getByText("正在检查更新…")).toBeVisible()
    expect(screen.getByRole("progressbar", { name: "客户端更新进度" })).not.toHaveAttribute("aria-valuenow")
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
  })

  it("reports real progress and keeps unknown download sizes indeterminate", () => {
    mock.state = { ...mock.state, phase: "downloading", downloadedBytes: 208, totalBytes: 326 }
    const { rerender } = render(<AccountUpdateFooter />)
    expect(screen.getByText(/63%/)).toBeVisible()
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "63")
    mock.state = { ...mock.state, totalBytes: null }
    rerender(<AccountUpdateFooter />)
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow")
    expect(screen.queryByText(/63%/)).not.toBeInTheDocument()
  })

  it("shows automatic restart instead of any restart or defer button", () => {
    mock.state = { ...mock.state, phase: "ready" }
    render(<AccountUpdateFooter />)
    expect(screen.getByText("下载完成，正在自动重启…")).toBeVisible()
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100")
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })

  it("states retry behavior precisely without blocking the login flow", () => {
    mock.state = { ...mock.state, phase: "error", error: "download", retrying: true }
    const { rerender } = render(<AccountUpdateFooter />)
    expect(screen.getByText("更新暂不可用，稍后自动重试")).toBeVisible()
    mock.state = { ...mock.state, retrying: false }
    rerender(<AccountUpdateFooter />)
    expect(screen.getByText("更新失败，下次启动将重试")).toBeVisible()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })
})
