import "@testing-library/jest-dom/vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import { TooltipProvider } from "@/components/ui/tooltip"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { saveTemplateStyle } from "@/api"
import { TemplateLibrary } from "./components/TemplateLibrary"
import { TemplateStatusText } from "./components/TemplateDetail"
import { ThemeSelector } from "./components/style-panel/ThemeSelector"
import { builtInSamples, defaultClassicA4Style } from "./data"

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
  createResumeVersion: vi.fn(),
  deleteTemplateStyle: vi.fn(async () => undefined),
  saveTemplateSample: vi.fn(async () => builtInSamples["sample-tech-zh"]),
  saveTemplateStyle: vi.fn(async () => defaultClassicA4Style),
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

  it("filters custom and default themes", async () => {
    renderThemeLibrary()
    expect(await screen.findByRole("heading", { name: "主题库" })).toBeInTheDocument()
    clickButtonText("官方")
    expect(document.body.textContent).toContain("经典 A4")
    expect(document.body.textContent).not.toContain("我的黑白主题")
  })

})
