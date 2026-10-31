import "@testing-library/jest-dom/vitest"
import { useEffect } from "react"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { applyAccountState, getAccountView, setAccountAction, type AccountState } from "@/accountState"
import { testAccountSession } from "@/test/accountFixture"
import { AccountGate } from "./AccountGate"

const mocks = vi.hoisted(() => ({ login: vi.fn(), importData: vi.fn(), skip: vi.fn(), finishLock: vi.fn() }))
vi.mock("@/accountState", async (original) => ({ ...await original<object>(), connectAccountState: () => () => {} }))
vi.mock("@/accountActions", () => ({
  signInAccount: mocks.login, importLocalAccountData: mocks.importData, skipLocalAccountData: mocks.skip,
  finishAccountLock: mocks.finishLock, cancelAccountSignIn: vi.fn(),
  prepareAccountUpdate: vi.fn(), finishAccountUpdate: vi.fn(),
}))
vi.mock("@/desktopWindow", () => ({ closeDesktopWindow: vi.fn(), minimizeDesktopWindow: vi.fn(), toggleMaximizeDesktopWindow: vi.fn() }))

function publish(status: AccountState["status"], id = "A") {
  applyAccountState({
    revision: getAccountView().state.revision + 1, status, configured: status !== "unconfigured", providers: ["github"],
    user: status === "ready" || status === "locking" || status === "needs_import" ? { id, name: `账号 ${id}` } : null,
    session: status === "ready" || status === "locking" ? testAccountSession(id) : null,
    legacy: status === "needs_import" ? { import_started: false, sources: [{ id: "installed", path: "C:/TypeDance", file_count: 3 }] } : null, error: null,
  })
}

beforeEach(() => { HTMLElement.prototype.scrollIntoView = vi.fn(); vi.clearAllMocks(); setAccountAction("idle"); publish("signed_out") })
afterEach(cleanup)

describe("account workspace gate", () => {
  it("never mounts the business workspace while signed out or unconfigured", () => {
    const mounted = vi.fn()
    function Workspace() { useEffect(mounted, []); return <p>私有简历内容</p> }
    render(<AccountGate><Workspace /></AccountGate>)
    expect(screen.queryByText("私有简历内容")).not.toBeInTheDocument()
    expect(mounted).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "使用 GitHub 登录" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Google|微信/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "使用 GitHub 登录" }))
    expect(mocks.login).toHaveBeenCalledWith("github")
    act(() => publish("unconfigured"))
    expect(screen.queryByRole("button", { name: "使用 GitHub 登录" })).not.toBeInTheDocument()
    expect(screen.getByText(/登录服务尚未配置/)).toBeInTheDocument()
    expect(mounted).not.toHaveBeenCalled()
  })

  it("requires an explicit choice before existing local data is assigned", () => {
    publish("needs_import")
    render(<AccountGate><p>私有简历内容</p></AccountGate>)
    expect(screen.getByText("当前账号：账号 A")).toBeInTheDocument()
    expect(screen.getByText(/3 个文件/)).toBeInTheDocument()
    expect(mocks.importData).not.toHaveBeenCalled()
    expect(mocks.skip).not.toHaveBeenCalled()
    expect(screen.queryByText("私有简历内容")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "导入并进入工作台" }))
    expect(mocks.importData).toHaveBeenCalledWith("installed")
  })

  it("lets users skip multiple historical sources without selecting or importing one", () => {
    publish("needs_import")
    applyAccountState({ ...getAccountView().state, revision: getAccountView().state.revision + 1,
      legacy: { import_started: false, sources: [{ id: "installed", path: "C:/TypeDance", file_count: 3 }, { id: "home", path: "C:/Users/test/.typedance", file_count: 5 }] } })
    render(<AccountGate><p>私有简历内容</p></AccountGate>)
    expect(screen.getByRole("button", { name: "导入并进入工作台" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "暂不导入，进入工作台" }))
    expect(mocks.skip).toHaveBeenCalledOnce()
    expect(mocks.importData).not.toHaveBeenCalled()
    expect(screen.queryByText("私有简历内容")).not.toBeInTheDocument()
  })

  it("imports the selected source and clears that choice when the account changes", () => {
    const sources = [{ id: "installed", path: "C:/TypeDance", file_count: 3 }, { id: "home", path: "C:/Users/test/.typedance", file_count: 5 }]
    publish("needs_import")
    applyAccountState({ ...getAccountView().state, revision: getAccountView().state.revision + 1, legacy: { import_started: false, sources } })
    render(<AccountGate><p>私有简历内容</p></AccountGate>)
    fireEvent.keyDown(screen.getByRole("combobox", { name: "历史数据目录" }), { key: "Enter" })
    fireEvent.click(screen.getByRole("option", { name: "C:/Users/test/.typedance" }))
    fireEvent.click(screen.getByRole("button", { name: "导入并进入工作台" }))
    expect(mocks.importData).toHaveBeenCalledWith("home")
    act(() => {
      publish("needs_import", "B")
      applyAccountState({ ...getAccountView().state, revision: getAccountView().state.revision + 1, legacy: { import_started: false, sources } })
    })
    expect(screen.getByRole("button", { name: "导入并进入工作台" })).toBeDisabled()
    act(() => setAccountAction("switching"))
    expect(screen.getByRole("combobox", { name: "历史数据目录" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "暂不导入，进入工作台" })).toBeDisabled()
  })

  it("requires resuming an interrupted import before entering its workspace", () => {
    publish("needs_import")
    applyAccountState({ ...getAccountView().state, revision: getAccountView().state.revision + 1,
      legacy: { import_started: true, sources: [{ id: "installed", path: "C:/TypeDance", file_count: 3 }] } })
    render(<AccountGate><p>私有简历内容</p></AccountGate>)
    expect(screen.getByRole("combobox", { name: "历史数据目录" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "暂不导入，进入工作台" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "继续导入并进入工作台" }))
    expect(mocks.importData).toHaveBeenCalledWith("installed")
    expect(mocks.skip).not.toHaveBeenCalled()
  })

  it("shows only configured providers in WeChat, Google, GitHub order", () => {
    applyAccountState({ ...getAccountView().state, revision: getAccountView().state.revision + 1,
      providers: ["github", "wechat", "google"] })
    render(<AccountGate><p>私有简历内容</p></AccountGate>)
    expect(screen.getAllByRole("button", { name: /使用.*登录/ }).map(button => button.textContent)).toEqual([
      "使用微信登录", "使用 Google 登录", "使用 GitHub 登录",
    ])
    fireEvent.click(screen.getByRole("button", { name: "使用微信登录" }))
    expect(mocks.login).toHaveBeenCalledWith("wechat")
    expect(screen.queryByRole("button", { name: "最大化" })).not.toBeInTheDocument()
  })

  it("keeps drafts mounted and concealed during expiry saving, then destroys the old tree", () => {
    publish("ready")
    const unmount = vi.fn()
    function Workspace() { useEffect(() => unmount, []); return <p>未保存的私有内容</p> }
    render(<AccountGate><Workspace /></AccountGate>)
    expect(screen.getByText("未保存的私有内容")).toBeVisible()
    act(() => publish("locking"))
    expect(screen.getByText("未保存的私有内容")).not.toBeVisible()
    expect(unmount).not.toHaveBeenCalled()
    expect(mocks.finishLock).toHaveBeenCalledTimes(1)
    act(() => publish("locked"))
    expect(screen.queryByText("未保存的私有内容")).not.toBeInTheDocument()
    expect(unmount).toHaveBeenCalledTimes(1)
  })

  it("recreates all business component state for a different native session", () => {
    publish("ready")
    const mounted = vi.fn()
    const unmount = vi.fn()
    function Workspace() { useEffect(() => { mounted(); return unmount }, []); return <p>工作区</p> }
    render(<AccountGate><Workspace /></AccountGate>)
    act(() => publish("ready", "B"))
    expect(mounted).toHaveBeenCalledTimes(2)
    expect(unmount).toHaveBeenCalledTimes(1)
  })
})
