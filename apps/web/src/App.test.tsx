import "@testing-library/jest-dom/vitest"
import { transferableAbortController } from "node:util"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes, useOutletContext, useParams } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SiteLayout, type RevisionWorkspaceChromeContext } from "./components/SiteLayout"
import { ResumePackModeSwitch } from "./features/resume-pack/ResumePackNavigation"
import { appRoutes } from "./router"

const documentDefaults = { status: "active", target_language: "zh-CN", updated_at: "2026-10-20T00:00:00.000Z" } as const

vi.mock("./features/revision/RevisionWorkspacePage", () => ({
  RevisionWorkspacePage: () => <><ResumePackModeSwitch /><h1>简历编辑器 {useParams().documentId}</h1></>,
}))
vi.mock("./features/templates/components/TemplateWorkspacePage", () => ({
  TemplateWorkspacePage: () => <><ResumePackModeSwitch /><h1>模板编辑器 {useParams().templateId}</h1></>,
}))

function ChromeContextProbe() {
  const context = useOutletContext<RevisionWorkspaceChromeContext>()
  return <span data-testid="workbench-sidebar-state">{context.workbenchSidebarVisible ? "visible" : "hidden"}</span>
}

function renderSiteLayoutAt(pathname: string) {
  render(<MemoryRouter initialEntries={[pathname]}><Routes><Route element={<SiteLayout />}>
    <Route path="*" element={<ChromeContextProbe />} />
  </Route></Routes></MemoryRouter>)
}

function renderAppAt(pathname = "/") {
  const router = createMemoryRouter(appRoutes, { initialEntries: [pathname] })
  render(<RouterProvider router={router} />)
  return router
}

describe("App navigation", () => {
  beforeEach(() => {
    vi.stubGlobal("AbortController", transferableAbortController().constructor)
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })))
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it("starts in the editor shell with sidebar actions when there are no resumes", async () => {
    const router = renderAppAt()
    expect(await screen.findByText("还没有简历。")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "开始编辑简历" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "新建简历" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "导入" })).not.toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "简历" })).toBeChecked()
    expect(screen.queryByRole("heading", { name: "工作台" })).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/packs/resume/workspaces")
  })

  it("opens the first resume directly without a card overview", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([
      { ...documentDefaults, id: "other-pack", title: "其他资料", pack_id: "other" },
      { ...documentDefaults, id: "doc-first", title: "我的简历", pack_id: "resume" },
      { ...documentDefaults, id: "doc-second", title: "第二份简历", pack_id: "resume" },
    ]), { status: 200 })))
    const router = renderAppAt()
    expect(await screen.findByRole("heading", { name: "简历编辑器 doc-first" })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/packs/resume/workspaces/doc-first")
    expect(router.state.historyAction).toBe("REPLACE")
  })

  it("opens the default template editor at the template entry", async () => {
    const router = renderAppAt("/packs/resume/templates")
    expect(await screen.findByRole("heading", { name: "模板编辑器 classic-a4" })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/packs/resume/templates/classic-a4")
    expect(screen.getByRole("radio", { name: "模板" })).toBeChecked()
  })

  it("switches directly between the sidebar modes", async () => {
    const router = renderAppAt()
    await screen.findByText("还没有简历。")
    fireEvent.click(screen.getByRole("radio", { name: "模板" }))
    await screen.findByRole("heading", { name: "模板编辑器 classic-a4" })
    fireEvent.click(screen.getByRole("radio", { name: "简历" }))
    await screen.findByRole("heading", { name: "开始编辑简历" })
    expect(router.state.location.pathname).toBe("/packs/resume/workspaces")
  })

  it("does not open a resume after the user switches modes during loading", async () => {
    let finishLoading!: (response: Response) => void
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { finishLoading = resolve })))
    const router = renderAppAt()
    fireEvent.click(await screen.findByRole("radio", { name: "模板" }))
    await screen.findByRole("heading", { name: "模板编辑器 classic-a4" })
    await act(async () => finishLoading(new Response(JSON.stringify([
      { ...documentDefaults, id: "doc-late", title: "延迟返回的简历", pack_id: "resume" },
    ]), { status: 200 })))
    expect(router.state.location.pathname).toBe("/packs/resume/templates/classic-a4")
  })

  it("keeps navigation and retry available if the resume list cannot load", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline") }))
    renderAppAt()
    expect(await screen.findByRole("alert")).toHaveTextContent("简历列表加载失败")
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "模板" })).toBeEnabled()
  })

  it("keeps an import dialog open if the initial resume list finishes loading", async () => {
    let finishLoading!: (response: Response) => void
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { finishLoading = resolve })))
    const router = renderAppAt()
    fireEvent.click(await screen.findByRole("button", { name: "新建简历" }))
    fireEvent.click(screen.getByRole("radio", { name: "导入已有简历" }))
    await screen.findByRole("dialog", { name: "新建简历" })
    await act(async () => finishLoading(new Response(JSON.stringify([
      { ...documentDefaults, id: "doc-late", title: "延迟返回的简历", pack_id: "resume" },
    ]), { status: 200 })))
    expect(screen.getByRole("dialog", { name: "新建简历" })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/packs/resume/workspaces")
  })

  it.each(["/packs/resume/workspaces", "/packs/resume/workspaces/doc-one", "/packs/resume/templates/classic-a4"])(
    "uses one editor shell and sidebar toggle on %s", (pathname) => {
      renderSiteLayoutAt(pathname)
      expect(document.querySelector('[data-slot="sidebar-inset"]')).toHaveClass("h-svh", "pt-9")
      expect(document.querySelector('[data-slot="sidebar"]')).not.toBeInTheDocument()
      expect(screen.queryByLabelText("breadcrumb")).not.toBeInTheDocument()
      const toggle = screen.getByTestId("global-left-sidebar-toggle")
      fireEvent.click(toggle)
      expect(toggle).toHaveAttribute("aria-label", "显示左侧导航")
      expect(screen.getByTestId("workbench-sidebar-state")).toHaveTextContent("hidden")
    },
  )

  it("can restore the sidebar from an empty workspace", async () => {
    renderAppAt()
    await screen.findByText("还没有简历。")
    fireEvent.click(screen.getByRole("button", { name: "隐藏左侧导航" }))
    expect(screen.queryByRole("button", { name: "新建简历" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "显示左侧导航" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "新建简历" })).toBeInTheDocument())
  })
})
