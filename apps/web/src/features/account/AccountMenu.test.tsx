import "@testing-library/jest-dom/vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { applyAccountState, getAccountView, setAccountAction, type AccountState } from "@/accountState"
import { captureAccountSession } from "@/accountSession"
import { clientUpdater } from "@/features/settings/client-updater"
import { testAccountSession } from "@/test/accountFixture"
import { AccountMenu } from "./AccountMenu"

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), flush: vi.fn(), updater: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }))
vi.mock("@/features/revision/useSourceCanvasAutosave", () => ({ flushAllSourceCanvasSaves: mocks.flush, retryAllSourceCanvasSaves: mocks.flush }))
vi.mock("@/features/settings/useClientUpdater", () => ({ useClientUpdater: mocks.updater }))
vi.mock("@/features/settings/AiSettingsPanel", () => ({ AiSettingsPanel: () => <p>模型与密钥配置</p> }))

function account(id = "A", status: AccountState["status"] = "ready"): AccountState {
  return {
    revision: getAccountView().state.revision + 1,
    status, configured: true, providers: ["wechat", "google", "github"],
    user: status === "ready" ? { id, name: `账号 ${id}`, email: `${id}@example.invalid` } : null,
    session: status === "ready" ? testAccountSession(id) : null,
    error: null, legacy: null,
  }
}

async function openMenu() {
  const trigger = screen.getByRole("button", { name: /账号菜单/ })
  trigger.focus()
  fireEvent.keyDown(trigger, { key: "Enter" })
  return screen.findByRole("menu")
}

beforeEach(() => {
  mocks.invoke.mockReset()
  mocks.flush.mockReset().mockResolvedValue(true)
  mocks.updater.mockReturnValue(clientUpdater.getSnapshot())
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })))
  setAccountAction("idle")
  applyAccountState(account())
})

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe("sidebar account entry", () => {
  it("keeps identity visible and replaces it when the verified account changes", () => {
    render(<AccountMenu />)
    expect(screen.getByRole("button", { name: "账号菜单：账号 A" })).toBeInTheDocument()
    expect(screen.getByText("已登录")).toBeInTheDocument()
    expect(screen.getByText("账")).toBeInTheDocument()
    act(() => applyAccountState(account("B")))
    expect(screen.getByRole("button", { name: "账号菜单：账号 B" })).toBeInTheDocument()
    expect(screen.queryByText("账号 A")).not.toBeInTheDocument()
  })

  it("opens by keyboard, exposes account actions and restores focus after Escape", async () => {
    render(<AccountMenu />)
    const menu = await openMenu()
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["账号与安全", "设置", "切换账号", "退出登录"])
    expect(within(menu).getByText("A@example.invalid")).toBeInTheDocument()
    fireEvent.keyDown(menu, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument())
    expect(screen.getByRole("button", { name: /账号菜单/ })).toHaveFocus()
  })

  it("opens account security directly without a settings dialog", async () => {
    mocks.invoke.mockResolvedValue(undefined)
    render(<AccountMenu />)
    fireEvent.click(within(await openMenu()).getByRole("menuitem", { name: "账号与安全" }))
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("open_account_center"))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("opens general settings from the menu with account controls removed", async () => {
    render(<AccountMenu />)
    fireEvent.click(within(await openMenu()).getByRole("menuitem", { name: "设置" }))
    const dialog = await screen.findByRole("dialog", { name: "设置" })
    expect(within(dialog).getByRole("tab", { name: "AI 设置" })).toHaveAttribute("data-state", "active")
    expect(within(dialog).queryByRole("tab", { name: "账号" })).not.toBeInTheDocument()
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }))
    await waitFor(() => expect(screen.getByRole("button", { name: /账号菜单/ })).toHaveFocus())
  })

  it("keeps update discovery and opens the update tab when a new version is available", async () => {
    mocks.updater.mockReturnValue({ ...clientUpdater.getSnapshot(), supported: true, phase: "available", update: { version: "0.1.15", notes: "", publishedAt: null } })
    render(<AccountMenu />)
    expect(screen.getByRole("button", { name: /有客户端更新/ })).toBeInTheDocument()
    const menu = await openMenu()
    expect(within(menu).getByText("有更新")).toBeInTheDocument()
    fireEvent.click(within(menu).getByRole("menuitem", { name: /设置/ }))
    const dialog = await screen.findByRole("dialog", { name: "设置" })
    expect(within(dialog).getByRole("tab", { name: "客户端更新" })).toHaveAttribute("data-state", "active")
  })

  it.each([["切换账号", "sign_in_account"], ["退出登录", "sign_out_account"]])("routes %s through the existing save gate", async (label, command) => {
    mocks.invoke.mockImplementation(async () => account("B", command === "sign_in_account" ? "ready" : "signed_out"))
    render(<AccountMenu />)
    fireEvent.click(within(await openMenu()).getByRole("menuitem", { name: label }))
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(command, undefined))
    expect(mocks.flush).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/account/pause"), expect.objectContaining({ method: "POST" }))
    await waitFor(() => expect(getAccountView().phase).toBe("idle"))
  })

  it("leaves save failures visible in the sidebar and retains the current account", async () => {
    mocks.flush.mockResolvedValue(false)
    render(<AccountMenu />)
    const session = captureAccountSession()
    fireEvent.click(within(await openMenu()).getByRole("menuitem", { name: "退出登录" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("有内容尚未保存")
    expect(screen.getByRole("button", { name: "账号菜单：账号 A" })).toBeEnabled()
    expect(captureAccountSession()).toBe(session)
    expect(mocks.invoke).not.toHaveBeenCalled()
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
  })
})
