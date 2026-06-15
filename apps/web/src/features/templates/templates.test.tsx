import "@testing-library/jest-dom/vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import { TooltipProvider } from "@/components/ui/tooltip"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { saveTemplateStyle } from "@/api"
import { TemplateLibrary } from "./components/TemplateLibrary"
import { TemplateStatusText } from "./components/TemplateDetail"
import { InspectorAccordion } from "./components/style-panel/InspectorControls"
import { ThemeSelector } from "./components/style-panel/ThemeSelector"
import { TypographySection } from "./components/style-panel/sections/TypographySection"
import { builtInSamples, defaultClassicA4Style } from "./data"
import {
  ARIAL_FONT_VALUE,
  MICROSOFT_YAHEI_FONT_STACK,
  MICROSOFT_YAHEI_FONT_VALUE,
  SEGOE_UI_FONT_VALUE,
  buildFontFamilyStack,
} from "./style-engine/fonts"

const customThemeStyle = {
  ...defaultClassicA4Style,
  template_id: "custom-theme-test",
  name: "我的黑白主题",
  preset: "",
  updated_at: "2026-05-12T00:00:00.000Z",
}

vi.mock("@/api", () => ({
  getTemplateSample: vi.fn(async () => { throw new Error("no local sample"); }),
  getTemplateStyle: vi.fn(async () => { throw new Error("no local style"); }),
  listTemplateStyles: vi.fn(async () => [defaultClassicA4Style, customThemeStyle]),
  deleteTemplateStyle: vi.fn(async () => undefined),
  saveTemplateSample: vi.fn(async () => builtInSamples["sample-tech-zh"]),
  saveTemplateStyle: vi.fn(async () => defaultClassicA4Style),
}))

vi.mock("../workspace/components/ResumeRichTextEditor", () => ({
  ResumeRichTextEditor: ({ ariaLabel }: { ariaLabel?: string }) => (
    <div aria-label={ariaLabel} data-testid="mock-resume-editor" />
  ),
}))

describe("TemplateLibrary", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    cleanup()
  })

  function LocationProbe() {
    const location = useLocation()
    return <span data-testid="template-location">{location.pathname}</span>
  }

  function renderThemeLibrary(initialPath = "/packs/resume/templates") {
    const templateLibraryRoute = (
      <div>
        <LocationProbe />
        <TemplateLibrary uiLanguage="zh-CN" targetLanguage="zh-CN" />
      </div>
    )

    return render(
      <MemoryRouter initialEntries={[initialPath]}>
        <TooltipProvider>
          <Routes>
            {["/packs/resume/templates", "/packs/resume/templates/:templateId"].map((path) => (
              <Route key={path} path={path} element={templateLibraryRoute} />
            ))}
          </Routes>
        </TooltipProvider>
      </MemoryRouter>,
    )
  }

  function clickButtonText(label: string | RegExp) {
    const button = Array.from(document.querySelectorAll("button"))
      .find((element) => (
        typeof label === "string"
          ? element.textContent?.trim() === label
          : label.test(element.textContent ?? "")
      ))
    if (!button) throw new Error(`No button found for ${String(label)}`)
    fireEvent.click(button)
  }

  function updateLetterSpacing(value: string) {
    const input = document.querySelector<HTMLInputElement>('input[placeholder="如 0.5px"]')
    if (!input) throw new Error("No letter spacing input found")
    fireEvent.change(input, { target: { value } })
  }

  it("renders actual theme library options in the theme selector", async () => {
    render(
      <ThemeSelector
        value="classic-a4"
        options={[
          { id: "custom-theme-test", title: "我的黑白主题", source: "custom" },
          { id: "classic-a4", title: "经典 A4", source: "default" },
        ]}
        onChange={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole("combobox", { name: "选择主题" }))
    const listbox = await screen.findByRole("listbox")
    expect(within(listbox).getByText("经典 A4")).toBeInTheDocument()
    expect(within(listbox).getByText("我的黑白主题")).toBeInTheDocument()
    expect(within(listbox).queryByText("现代")).not.toBeInTheDocument()
  })

  it("renders theme cards and opens theme detail", async () => {
    renderThemeLibrary()
    expect(await screen.findByRole("heading", { name: "主题库" })).toBeInTheDocument()
    clickButtonText(/经典 A4/)
    expect(screen.getByRole("button", { name: "返回主题库" })).toBeInTheDocument()
    expect(screen.getByTestId("template-location")).toHaveTextContent("/packs/resume/templates/classic-a4")
    expect(screen.getByLabelText("主题演示简历预览")).toBeInTheDocument()
    expect(screen.getByText("主题样式")).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "标题1" })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "标题2" })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "标题3" })).toBeInTheDocument()
    expect(screen.queryByRole("radio", { name: "一级标题" })).not.toBeInTheDocument()

    expect(screen.getByRole("combobox", { name: "选择主题" })).toHaveTextContent("经典 A4")
  })

  it("opens the official classic theme from the route id and resets it", async () => {
    renderThemeLibrary("/packs/resume/templates/classic-a4")

    expect(await screen.findByRole("button", { name: "返回主题库" })).toBeInTheDocument()
    expect(screen.getByTestId("template-location")).toHaveTextContent("/packs/resume/templates/classic-a4")

    clickButtonText("重置")

    await waitFor(() => {
      expect(saveTemplateStyle).toHaveBeenCalledWith(expect.objectContaining({
        template_id: "classic-a4",
        preset: "classic",
        blocks: defaultClassicA4Style.blocks,
      }))
    })
    expect(await screen.findByText("主题已重置为官方默认")).toBeInTheDocument()
  })

  it("keeps theme style edits as a draft until the user saves", async () => {
    renderThemeLibrary("/packs/resume/templates/classic-a4")

    expect(await screen.findByRole("button", { name: "返回主题库" })).toBeInTheDocument()
    vi.mocked(saveTemplateStyle).mockClear()

    updateLetterSpacing("0.5px")

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 350))
    })

    expect(saveTemplateStyle).not.toHaveBeenCalled()
    expect(screen.getByText("主题样式有未保存修改")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "保存" }))

    await waitFor(() => {
      expect(saveTemplateStyle).toHaveBeenCalledTimes(1)
    })
    expect(await screen.findByText("主题样式已保存")).toBeInTheDocument()
  })

  it("asks before leaving a theme with unsaved style edits", async () => {
    renderThemeLibrary("/packs/resume/templates/classic-a4")

    const backButton = await screen.findByRole("button", { name: "返回主题库" })
    vi.mocked(saveTemplateStyle).mockClear()

    updateLetterSpacing("0.5px")

    fireEvent.click(backButton)

    expect(screen.getByRole("dialog", { name: "还有未保存的主题样式" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "不保存返回" }))

    expect(saveTemplateStyle).not.toHaveBeenCalled()
    expect(screen.getByTestId("template-location")).toHaveTextContent("/packs/resume/templates")
  })

  it("animates pending style status dots", () => {
    vi.useFakeTimers()
    try {
      render(<TemplateStatusText status="主题正在保存" className="" />)

      expect(screen.getByText((_, element) => element?.tagName === "P" && element.textContent === "主题正在保存.")).toBeInTheDocument()

      act(() => {
        vi.advanceTimersByTime(420)
      })
      expect(screen.getByText((_, element) => element?.tagName === "P" && element.textContent === "主题正在保存..")).toBeInTheDocument()

      act(() => {
        vi.advanceTimersByTime(420)
      })
      expect(screen.getByText((_, element) => element?.tagName === "P" && element.textContent === "主题正在保存...")).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it("selects multiple fonts and reorders the font stack", () => {
    const onChange = vi.fn()
    const renderTypography = (fontFamily?: string) => (
      <InspectorAccordion type="single" collapsible defaultValue="typography">
        <TypographySection value={fontFamily ? { fontFamily } : {}} onChange={onChange} />
      </InspectorAccordion>
    )
    const { rerender } = render(renderTypography())

    const fontTrigger = document.querySelector<HTMLButtonElement>('button[aria-label="字体"]')
    if (!fontTrigger) throw new Error("No font trigger found")
    fireEvent.click(fontTrigger)
    const microsoftYaheiCheckbox = document.getElementById("font-family--Microsoft-YaHei-")
    if (!microsoftYaheiCheckbox) throw new Error("No Microsoft YaHei checkbox found")
    fireEvent.click(microsoftYaheiCheckbox)
    expect(onChange).toHaveBeenLastCalledWith({
      fontFamily: buildFontFamilyStack([MICROSOFT_YAHEI_FONT_VALUE]),
    })

    rerender(renderTypography(buildFontFamilyStack([MICROSOFT_YAHEI_FONT_VALUE])))
    const arialCheckbox = document.getElementById("font-family-Arial")
    if (!arialCheckbox) throw new Error("No Arial checkbox found")
    fireEvent.click(arialCheckbox)
    expect(onChange).toHaveBeenLastCalledWith({
      fontFamily: buildFontFamilyStack([MICROSOFT_YAHEI_FONT_VALUE, ARIAL_FONT_VALUE]),
    })

    rerender(renderTypography(buildFontFamilyStack([MICROSOFT_YAHEI_FONT_VALUE, ARIAL_FONT_VALUE])))
    const moveArialUpButton = document.querySelector<HTMLButtonElement>('button[aria-label="上移 Arial"]')
    if (!moveArialUpButton) throw new Error("No move up button found for Arial")
    fireEvent.click(moveArialUpButton)
    expect(onChange).toHaveBeenLastCalledWith({
      fontFamily: buildFontFamilyStack([ARIAL_FONT_VALUE, MICROSOFT_YAHEI_FONT_VALUE]),
    })
  })

  it("shows every selectable font from the classic A4 font stack", () => {
    const onChange = vi.fn()
    render(
      <InspectorAccordion type="single" collapsible defaultValue="typography">
        <TypographySection value={{ fontFamily: MICROSOFT_YAHEI_FONT_STACK }} onChange={onChange} />
      </InspectorAccordion>,
    )

    const fontTrigger = document.querySelector<HTMLButtonElement>('button[aria-label="字体"]')
    if (!fontTrigger) throw new Error("No font trigger found")
    fireEvent.click(fontTrigger)

    expect(document.getElementById("font-family--Microsoft-YaHei-")).toHaveAttribute("aria-checked", "true")
    expect(document.getElementById("font-family--Segoe-UI-")).toHaveAttribute("aria-checked", "true")
    expect(document.getElementById("font-family-Arial")).toHaveAttribute("aria-checked", "true")
    expect(MICROSOFT_YAHEI_FONT_STACK).toBe(buildFontFamilyStack([
      MICROSOFT_YAHEI_FONT_VALUE,
      SEGOE_UI_FONT_VALUE,
      ARIAL_FONT_VALUE,
    ]))
  })

  it("filters custom and default themes", async () => {
    renderThemeLibrary()
    expect(await screen.findByRole("heading", { name: "主题库" })).toBeInTheDocument()
    clickButtonText("官方")
    expect(document.body.textContent).toContain("经典 A4")
    expect(document.body.textContent).not.toContain("我的黑白主题")
  })

})
