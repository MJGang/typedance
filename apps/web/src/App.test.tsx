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

  it("renders the resume pack workspaces page as the default entry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })),
    )

    render(<App />)

    expect(await screen.findByRole("heading", { name: "工作台" })).toBeInTheDocument()
    expect(screen.getByText("Resume Pack")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "工作台" })).toHaveAttribute("data-active", "true")
    expect(screen.getByRole("link", { name: "简历成品" })).not.toHaveAttribute("data-active")
    expect(screen.queryByRole("button", { name: "切换 Pack" })).not.toBeInTheDocument()
  })

  it("marks resume pack entries active on nested pages", () => {
    renderSidebarAt("/packs/resume/templates")

    expect(screen.getByRole("link", { name: "工作台" })).not.toHaveAttribute("data-active")
    expect(screen.getByRole("link", { name: "模板" })).toHaveAttribute("data-active", "true")
  })
});
