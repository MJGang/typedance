import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { TooltipProvider } from "@/components/ui/tooltip"
import { afterEach, describe, expect, it, vi } from "vitest"
import { defaultClassicA4Style } from "../../data"
import { StylePanel } from "./StylePanel"

function renderPanel(activeBlock: "heading2" | "paragraph", onChange = vi.fn()) {
  return {
    onChange,
    ...render(
      <TooltipProvider>
        <StylePanel
          styleConfig={defaultClassicA4Style}
          selectedThemeId="classic-a4"
          themeOptions={[{ id: "classic-a4", title: "经典 A4", source: "default" }]}
          onChange={onChange}
          onThemeChange={vi.fn()}
          activeBlock={activeBlock}
          onActiveBlockChange={vi.fn()}
          uiLanguage="zh-CN"
        />
      </TooltipProvider>,
    ),
  }
}

describe("StylePanel", () => {
  afterEach(cleanup)

  it("adds the accent control and three full-width H2 decoration rows to the existing panel", () => {
    renderPanel("heading2")

    expect(screen.getByText("主题强调色")).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: /极简底线/ })).toBeChecked()
    expect(screen.getByRole("radio", { name: /左线底纹/ })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: /圆点短纹/ })).toBeInTheDocument()
    expect(document.querySelectorAll("[data-heading-option]")).toHaveLength(3)
    expect(screen.queryByLabelText("背景颜色")).not.toBeInTheDocument()
    expect(screen.queryByText("边框")).not.toBeInTheDocument()
  })

  it("keeps paragraph background and border controls without showing H2 decorations", () => {
    renderPanel("paragraph")

    expect(screen.queryByText("标题款式")).not.toBeInTheDocument()
    fireEvent.click(screen.getByText("颜色与背景"))
    expect(screen.getByLabelText("背景颜色")).toBeInTheDocument()
    expect(screen.getByText("边框")).toBeInTheDocument()
  })

  it("updates the complete draft and clears the preset for accent and H2 style changes", () => {
    const onChange = vi.fn()
    renderPanel("heading2", onChange)

    fireEvent.click(screen.getByRole("radio", { name: /左线底纹/ }))
    expect(onChange).toHaveBeenLastCalledWith({
      ...defaultClassicA4Style,
      preset: "",
      blocks: {
        ...defaultClassicA4Style.blocks,
        heading2: {
          ...defaultClassicA4Style.blocks.heading2,
          decorationStyle: "accent-wash",
        },
      },
    })

    fireEvent.click(screen.getByRole("button", { name: "主题强调色" }))
    fireEvent.click(screen.getByRole("button", { name: "#1677ff" }))
    expect(onChange).toHaveBeenLastCalledWith({
      ...defaultClassicA4Style,
      preset: "",
      theme: { accentColor: "#1677ff" },
    })
  })
})
