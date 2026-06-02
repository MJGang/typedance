import "@testing-library/jest-dom/vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ModuleInteractionLayer } from "./ModuleInteractionLayer"
import type { ModuleVisualRegion } from "./moduleInteractions"

const regions: ModuleVisualRegion[] = [
  {
    moduleId: "mod_active",
    pageIndex: 0,
    top: 12,
    left: 24,
    width: 320,
    height: 96,
  },
  {
    moduleId: "mod_hovered",
    pageIndex: 0,
    top: 120,
    left: 24,
    width: 320,
    height: 48,
  },
  {
    moduleId: "mod_idle",
    pageIndex: 0,
    top: 180,
    left: 24,
    width: 320,
    height: 48,
  },
]

describe("ModuleInteractionLayer", () => {
  it("renders an active region with its absolute rect", () => {
    render(
      <ModuleInteractionLayer
        regions={regions}
        activeModuleId="mod_active"
        hoveredModuleId={null}
      />,
    )

    expect(screen.getByTestId("module-region-mod_active")).toHaveAttribute("data-state", "active")
    expect(screen.getByTestId("module-region-mod_active")).toHaveStyle({
      top: "12px",
      left: "24px",
      width: "320px",
      height: "96px",
    })
  })

  it("renders a hovered region", () => {
    render(
      <ModuleInteractionLayer
        regions={regions}
        activeModuleId={null}
        hoveredModuleId="mod_hovered"
      />,
    )

    expect(screen.getByTestId("module-region-mod_hovered")).toHaveAttribute("data-state", "hovered")
  })

  it("keeps the active state when the same module is also hovered", () => {
    render(
      <ModuleInteractionLayer
        regions={regions}
        activeModuleId="mod_active"
        hoveredModuleId="mod_active"
      />,
    )

    expect(screen.getByTestId("module-region-mod_active")).toHaveAttribute("data-state", "active")
  })

  it("renders every region for a stateful module that crosses pages", () => {
    render(
      <ModuleInteractionLayer
        regions={[
          regions[0],
          {
            ...regions[0],
            pageIndex: 1,
            top: 900,
            height: 64,
          },
        ]}
        activeModuleId="mod_active"
        hoveredModuleId={null}
      />,
    )

    expect(screen.getAllByTestId("module-region-mod_active")).toHaveLength(2)
  })

  it("omits regions without active or hovered state", () => {
    render(
      <ModuleInteractionLayer
        regions={regions}
        activeModuleId="mod_active"
        hoveredModuleId={null}
      />,
    )

    expect(screen.queryByTestId("module-region-mod_idle")).not.toBeInTheDocument()
    expect(screen.queryByTestId("module-region-mod_hovered")).not.toBeInTheDocument()
  })

  it("marks the root as a non-interactive visual-only layer", () => {
    const { container } = render(
      <ModuleInteractionLayer
        regions={regions}
        activeModuleId={null}
        hoveredModuleId={null}
      />,
    )

    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true")
    expect(container.firstElementChild).toHaveClass(
      "absolute",
      "inset-0",
      "pointer-events-none",
      "td-module-interaction-layer",
      "td-module-interaction-only",
    )
    expect(container.firstElementChild).toBeEmptyDOMElement()
  })

  it("keeps print hiding and hover styling on visual regions instead of editor nodes", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8")

    expect(styles).toMatch(
      /@media print\s*{[\s\S]*\.td-module-interaction-only\s*{\s*display:\s*none !important;/,
    )
    expect(styles).toContain('.td-module-interaction-region[data-state="active"]')
    expect(styles).toContain('.td-module-interaction-region[data-state="hovered"]')
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*{\s*\.td-module-interaction-region\s*{\s*transition:\s*none;\s*}\s*}/,
    )
    expect(styles).not.toContain(".td-source-resume-canvas [data-module-id]")
  })
})
