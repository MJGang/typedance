import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BrowserRouter } from "react-router-dom"
import { SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"

const desktopActions = vi.hoisted(() => ({
  closeDesktopWindow: vi.fn(),
  minimizeDesktopWindow: vi.fn(),
  startDraggingDesktopWindow: vi.fn(),
  toggleMaximizeDesktopWindow: vi.fn(),
}))

vi.mock("@/desktopWindow", () => desktopActions)

import { GlobalTitleBar } from "./GlobalTitleBar"

function renderTitleBar(overrides: Partial<React.ComponentProps<typeof GlobalTitleBar>> = {}) {
  const props = {
    isWorkbenchRoute: true,
    workbenchSidebarVisible: true,
    setWorkbenchSidebarVisible: vi.fn(),
    ...overrides,
  }
  render(
    <BrowserRouter>
      <TooltipProvider>
        <SidebarProvider>
          <GlobalTitleBar {...props} />
        </SidebarProvider>
      </TooltipProvider>
    </BrowserRouter>,
  )
  return props
}

describe("GlobalTitleBar", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })))
  })

  afterEach(() => {
    document.documentElement.classList.remove("dark")
    localStorage.clear()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it("renders global navigation, theme, and window controls in the required order", () => {
    renderTitleBar()

    const labels = ["隐藏左侧导航", "返回", "前进", "切换深色模式", "最小化", "最大化或还原", "关闭"]
    const buttons = labels.map((label) => screen.getByRole("button", { name: label }))
    buttons.forEach((button, index) => expect(button).toHaveAttribute("data-control-order", String(index)))

    expect(buttons[1]).toBeDisabled()
    expect(buttons[2]).toBeDisabled()
    expect(screen.queryByTestId("site-left-sidebar-hidden-dot")).not.toBeInTheDocument()
    expect(buttons[3].nextElementSibling).toHaveAttribute("data-testid", "titlebar-window-separator")
    expect(buttons[3].nextElementSibling?.nextElementSibling).toBe(buttons[4])
  })

  it("shows a blue status dot only while the left sidebar is hidden", () => {
    renderTitleBar({ workbenchSidebarVisible: false })

    const dot = screen.getByTestId("site-left-sidebar-hidden-dot")
    expect(dot).toHaveClass("bg-sky-500", "rounded-full")
    expect(screen.getByRole("button", { name: "显示左侧导航" })).toContainElement(dot)
  })

  it("blends into the left sidebar without a horizontal divider on every app route", () => {
    renderTitleBar()

    expect(screen.getByTestId("global-titlebar")).toHaveClass("bg-sidebar")
    expect(screen.getByTestId("global-titlebar")).not.toHaveClass("border-b")

    cleanup()
    renderTitleBar({ isWorkbenchRoute: false })
    expect(screen.getByTestId("global-titlebar")).toHaveClass("bg-sidebar")
    expect(screen.getByTestId("global-titlebar")).not.toHaveClass("border-b")
  })

  it("controls the workbench sidebar, theme, drag region, and desktop window", () => {
    const setWorkbenchSidebarVisible = vi.fn()
    renderTitleBar({ setWorkbenchSidebarVisible })

    fireEvent.click(screen.getByRole("button", { name: "隐藏左侧导航" }))
    const updateSidebar = setWorkbenchSidebarVisible.mock.calls[0][0]
    expect(typeof updateSidebar === "function" ? updateSidebar(true) : updateSidebar).toBe(false)

    fireEvent.click(screen.getByRole("button", { name: "切换深色模式" }))
    expect(document.documentElement).toHaveClass("dark")
    expect(localStorage.getItem("theme")).toBe("dark")

    const dragRegion = screen.getByTestId("titlebar-drag-region")
    fireEvent.mouseDown(dragRegion, { buttons: 1, detail: 1 })
    expect(desktopActions.startDraggingDesktopWindow).toHaveBeenCalledOnce()
    fireEvent.mouseDown(dragRegion, { buttons: 1, detail: 2 })
    expect(desktopActions.toggleMaximizeDesktopWindow).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole("button", { name: "最小化" }))
    fireEvent.click(screen.getByRole("button", { name: "最大化或还原" }))
    fireEvent.click(screen.getByRole("button", { name: "关闭" }))
    expect(desktopActions.minimizeDesktopWindow).toHaveBeenCalledOnce()
    expect(desktopActions.toggleMaximizeDesktopWindow).toHaveBeenCalledTimes(2)
    expect(desktopActions.closeDesktopWindow).toHaveBeenCalledOnce()
  })
})
