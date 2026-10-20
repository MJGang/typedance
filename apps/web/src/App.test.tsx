import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useOutletContext } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { SiteLayout, type RevisionWorkspaceChromeContext } from "./components/SiteLayout";
import { SiteSidebar } from "./components/SiteSidebar";
import { SidebarProvider } from "./components/ui/sidebar";
import { TooltipProvider } from "./components/ui/tooltip";
import { ResumePackNavigationProvider } from "./features/resume-pack/ResumePackNavigation";

function renderSidebarAt(pathname: string) {
  render(
    <TooltipProvider>
      <SidebarProvider>
        <MemoryRouter initialEntries={[pathname]}>
          <ResumePackNavigationProvider>
          <SiteSidebar />
          </ResumePackNavigationProvider>
        </MemoryRouter>
      </SidebarProvider>
    </TooltipProvider>,
  )
}

function ChromeContextProbe() {
  const context = useOutletContext<RevisionWorkspaceChromeContext>()

  return (
    <>
      <span data-testid="assistant-panel-state">{context.assistantPanelVisible ? "visible" : "hidden"}</span>
      <span data-testid="workbench-sidebar-state">{context.workbenchSidebarVisible ? "visible" : "hidden"}</span>
    </>
  )
}

function renderSiteLayoutAt(pathname: string) {
  render(
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route element={<SiteLayout />}>
          <Route path="*" element={<ChromeContextProbe />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe("App", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })))
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    window.history.pushState(null, "", "/")
  })

  it("renders the resume pack workspaces page as the default entry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })),
    )

    render(<App />)

    expect(await screen.findByRole("heading", { name: "工作台" })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "简历" })).toBeChecked()
    expect(screen.getByRole("radio", { name: "模板" })).not.toBeChecked()
    expect(screen.queryByRole("link", { name: "简历成品" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "切换 Pack" })).not.toBeInTheDocument()
  })

  it("marks resume pack entries active on nested pages", async () => {
    renderSidebarAt("/packs/resume/templates/classic-a4")

    expect(screen.getByRole("radio", { name: "简历" })).not.toBeChecked()
    expect(screen.getByRole("radio", { name: "模板" })).toBeChecked()
    await screen.findByText("还没有简历。")
    expect(document.querySelector('[data-slot="sidebar-container"]')).toHaveClass("!top-9", "!bottom-0", "!h-auto")
  })

  it("frames the full site content as a rounded card with four-pixel right and bottom spacing", async () => {
    renderSiteLayoutAt("/packs/resume/workspaces")

    const shell = document.querySelector('[data-slot="sidebar-wrapper"]')
    const sidebarContainer = document.querySelector('[data-slot="sidebar-container"]')
    const contentInset = document.querySelector('[data-slot="sidebar-inset"]')

    expect(shell).toHaveClass("bg-sidebar")
    expect(sidebarContainer).toHaveClass("!border-r-0")
    expect(contentInset).toHaveClass(
      "mt-9",
      "mr-1",
      "mb-1",
      "h-[calc(100svh-2.25rem-4px)]",
      "rounded-xl",
      "border",
      "border-border",
    )
    expect(contentInset).not.toHaveClass("pt-9", "rounded-l-xl")
    await screen.findByText("还没有简历。")
  })

  it("uses the route-level workbench shell on workspace pages", () => {
    renderSiteLayoutAt("/packs/resume/workspaces/doc_1")

    const sidebarToggle = screen.getByTestId("global-left-sidebar-toggle")
    const themeToggle = screen.getByTestId("site-theme-toggle")
    const separator = screen.getByTestId("titlebar-window-separator")
    const minimizeButton = screen.getByRole("button", { name: "最小化" })

    expect(
      themeToggle.compareDocumentPosition(separator) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      separator.compareDocumentPosition(minimizeButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    expect(screen.getByTestId("global-titlebar")).toBeInTheDocument()
    expect(screen.queryByTestId("site-assistant-panel-toggle")).not.toBeInTheDocument()
    expect(document.querySelector('[data-slot="sidebar"]')).not.toBeInTheDocument()
    expect(document.querySelector('[data-slot="sidebar-wrapper"]')).toHaveClass("bg-sidebar")
    const contentInset = document.querySelector('[data-slot="sidebar-inset"]')
    expect(contentInset).toHaveClass("h-svh", "pt-9")
    expect(contentInset).not.toHaveClass(
      "mt-9",
      "mr-1",
      "mb-1",
      "rounded-xl",
      "border",
      "border-border",
    )
    expect(sidebarToggle).toHaveAttribute("aria-label", "隐藏左侧导航")
    expect(sidebarToggle).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByTestId("workbench-sidebar-state")).toHaveTextContent("visible")

    fireEvent.click(sidebarToggle)
    expect(sidebarToggle).toHaveAttribute("aria-label", "显示左侧导航")
    expect(sidebarToggle).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByTestId("workbench-sidebar-state")).toHaveTextContent("hidden")
  })

  it("does not render breadcrumbs in the site chrome", () => {
    renderSiteLayoutAt("/packs/resume/templates")

    expect(screen.queryByLabelText("breadcrumb")).not.toBeInTheDocument()
  })

  it("does not render breadcrumbs on nested resume pack pages", () => {
    renderSiteLayoutAt("/packs/resume/templates/classic-a4")

    expect(screen.queryByLabelText("breadcrumb")).not.toBeInTheDocument()
  })
});
