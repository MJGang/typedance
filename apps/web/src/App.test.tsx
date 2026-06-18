import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useOutletContext } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { SiteLayout, type RevisionWorkspaceChromeContext } from "./components/SiteLayout";
import { SiteSidebar } from "./components/SiteSidebar";
import { SidebarProvider } from "./components/ui/sidebar";
import { TooltipProvider } from "./components/ui/tooltip";

function renderSidebarAt(pathname: string) {
  render(
    <TooltipProvider>
      <SidebarProvider>
        <MemoryRouter initialEntries={[pathname]}>
          <SiteSidebar />
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
    expect(screen.getByText("Resume Pack")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "工作台" })).toHaveAttribute("data-active", "true")
    expect(screen.queryByRole("link", { name: "简历成品" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "切换 Pack" })).not.toBeInTheDocument()
  })

  it("marks resume pack entries active on nested pages", () => {
    renderSidebarAt("/packs/resume/templates/classic-a4")

    expect(screen.getByRole("link", { name: "工作台" })).not.toHaveAttribute("data-active")
    expect(screen.getByRole("link", { name: "模板" })).toHaveAttribute("data-active", "true")
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
