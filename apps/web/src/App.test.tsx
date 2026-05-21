import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
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

  it("renders the home page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })),
    )

    render(<App />)

    expect(screen.getAllByText("TypeDance").length).toBeGreaterThan(0)
    expect(await screen.findByRole("heading", { name: "我的简历" })).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: /导入旧简历/ }).length).toBeGreaterThan(0)
    expect(screen.getByRole("link", { name: "首页" })).toHaveAttribute("data-active", "true")
    expect(screen.getByRole("link", { name: "主题库" })).not.toHaveAttribute("data-active")
  })

  it("marks the theme library entry active on template pages", () => {
    renderSidebarAt("/templates")

    expect(screen.getByRole("link", { name: "首页" })).not.toHaveAttribute("data-active")
    expect(screen.getByRole("link", { name: "主题库" })).toHaveAttribute("data-active", "true")
  })
});
