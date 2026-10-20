import "@testing-library/jest-dom/vitest"
import { transferableAbortController } from "node:util"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { createMemoryRouter, RouterProvider, useLocation } from "react-router-dom"
import { SiteLayout } from "@/components/SiteLayout"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { getRevisionWorkspaceView, listRevisionDocuments, saveTemplateStyle, updateRevisionDocument } from "@/api"
import { TemplateLibrary } from "./components/TemplateLibrary"
import { TemplateStatusText } from "./components/TemplateDetail"
import { InspectorAccordion } from "./components/style-panel/InspectorControls"
import { ThemeSelector } from "./components/style-panel/ThemeSelector"
import { TypographySection } from "./components/style-panel/sections/TypographySection"
import { builtInSamples, defaultClassicA4Style } from "./data"
import { PANEL_WIDTH_STORAGE_KEY } from "../revision/panelLayout"
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
  listRevisionDocuments: vi.fn(async () => []),
  getRevisionWorkspaceView: vi.fn(),
  updateRevisionDocument: vi.fn(),
  deleteTemplateStyle: vi.fn(async () => undefined),
  saveTemplateSample: vi.fn(async () => builtInSamples["sample-tech-zh"]),
  saveTemplateStyle: vi.fn(async () => defaultClassicA4Style),
}))

vi.mock("../workspace/components/ResumeRichTextEditor", () => ({
  ResumeRichTextEditor: ({ ariaLabel, docJson }: { ariaLabel?: string; docJson?: unknown }) => (
    <div aria-label={ariaLabel} data-testid="mock-resume-editor">{JSON.stringify(docJson)}</div>
  ),
}))

describe("TemplateLibrary", () => {
  beforeAll(() => {
    // 数据路由创建的是 Node Request，需要使用同一环境的 AbortController。
    vi.stubGlobal("AbortController", transferableAbortController().constructor)
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })))
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    })
    vi.stubGlobal("ResizeObserver", class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    cleanup()
    localStorage.clear()
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

    const router = createMemoryRouter([{
      element: <SiteLayout />,
      children: [
        ...["/packs/resume/templates", "/packs/resume/templates/:templateId"].map((path) => ({
          path,
          element: templateLibraryRoute,
        })),
        { path: "/packs/resume/workspaces", element: <><LocationProbe /><h1>简历列表</h1></> },
      ],
    }], { initialEntries: [initialPath] })
    return render(<RouterProvider router={router} />)
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

  it("opens the template editor directly and lists templates beside the shared mode switch", async () => {
    renderThemeLibrary()
    expect(await screen.findByLabelText("主题演示简历预览")).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "模板" })).toBeChecked()
    expect(screen.getByRole("radio", { name: "简历" })).not.toBeChecked()
    expect(screen.getByRole("link", { name: "编辑模板 经典 A4" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("link", { name: "编辑模板 我的黑白主题" })).toBeInTheDocument()
    expect(screen.queryByText("全部模板")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "返回主题库" })).not.toBeInTheDocument()
    expect(screen.getByText("主题样式")).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "标题1" })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "标题2" })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "标题3" })).toBeInTheDocument()
    expect(screen.queryByRole("radio", { name: "一级标题" })).not.toBeInTheDocument()

    expect(screen.getByRole("combobox", { name: "选择主题" })).toHaveTextContent("经典 A4")
  })

  it("opens the official classic theme from the route id and resets it", async () => {
    renderThemeLibrary("/packs/resume/templates/classic-a4")

    expect(await screen.findByLabelText("主题演示简历预览")).toBeInTheDocument()
    expect(screen.getByTestId("template-location")).toHaveTextContent("/packs/resume/templates/classic-a4")

    clickButtonText("重置")

    await waitFor(() => {
      expect(saveTemplateStyle).toHaveBeenCalledWith(expect.objectContaining({
        template_id: "classic-a4",
        preset: "classic",
        theme: { accentColor: "#174EA6" },
        blocks: defaultClassicA4Style.blocks,
      }))
    })
    expect(await screen.findByText("主题已重置为官方默认")).toBeInTheDocument()
  })

  it("uses the same saved sidebar width as the resume editor", async () => {
    localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, JSON.stringify({ left: 340, right: 420 }))
    renderThemeLibrary()
    await screen.findByLabelText("主题演示简历预览")
    expect(screen.getByRole("complementary", { name: "模板列表" })).toHaveStyle({ width: "340px" })
  })

  it("keeps theme style edits as a draft until the user saves", async () => {
    renderThemeLibrary("/packs/resume/templates/classic-a4")

    expect(await screen.findByLabelText("主题演示简历预览")).toBeInTheDocument()
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

  it("saves the current style draft as an independent template", async () => {
    renderThemeLibrary()
    await screen.findByLabelText("主题演示简历预览")
    updateLetterSpacing("0.8px")
    fireEvent.click(screen.getByRole("button", { name: "另存为新模板" }))
    const dialog = screen.getByRole("dialog", { name: "另存为新模板" })
    fireEvent.change(within(dialog).getByLabelText("模板名称"), { target: { value: "投递专用" } })
    vi.mocked(saveTemplateStyle).mockImplementationOnce(async (style) => style)
    fireEvent.click(within(dialog).getByRole("button", { name: "创建模板" }))
    await screen.findByRole("heading", { name: "投递专用" })
    expect(saveTemplateStyle).toHaveBeenCalledWith(expect.objectContaining({
      template_id: expect.stringMatching(/^custom-theme-/), name: "投递专用",
      blocks: expect.objectContaining({ paragraph: expect.objectContaining({ letterSpacing: "0.8px" }) }),
    }))
    expect(screen.getByRole("link", { name: "编辑模板 经典 A4" })).toBeInTheDocument()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("previews a real resume without rewriting its structured layout and applies only its template", async () => {
    const docJson = { type: "doc", content: [{ type: "columns", attrs: { count: 4 }, content: [{ type: "column", content: [{ type: "paragraph", attrs: { textAlign: "right" }, content: [{ type: "text", text: "真实简历内容" }] }] }] }] }
    const document = { id: "doc-preview", title: "agent简历", pack_id: "resume", template_id: "classic-a4" }
    vi.mocked(listRevisionDocuments).mockResolvedValueOnce([document] as never)
    vi.mocked(getRevisionWorkspaceView).mockResolvedValueOnce({ document, source_resume_canvas: { doc_json: docJson } } as never)
    vi.mocked(updateRevisionDocument).mockResolvedValueOnce(document as never)
    renderThemeLibrary("/packs/resume/templates/custom-theme-test")
    await waitFor(() => expect(screen.getByTestId("mock-resume-editor")).toHaveTextContent("真实简历内容"))
    expect(screen.getByTestId("mock-resume-editor")).toHaveTextContent('"textAlign":"right"')
    fireEvent.click(screen.getByRole("button", { name: "应用到 agent简历" }))
    await waitFor(() => expect(updateRevisionDocument).toHaveBeenCalledWith("doc-preview", { template_id: "custom-theme-test" }))
    expect(saveTemplateStyle).not.toHaveBeenCalled()
    expect(await screen.findByText("已应用到 agent简历")).toBeInTheDocument()
  })

  it("does not apply an unsaved template when saving it fails", async () => {
    const document = { id: "doc-preview", title: "agent简历", pack_id: "resume", template_id: "classic-a4" }
    vi.mocked(listRevisionDocuments).mockResolvedValueOnce([document] as never)
    vi.mocked(getRevisionWorkspaceView).mockResolvedValueOnce({ document, source_resume_canvas: { doc_json: builtInSamples["sample-tech-zh"].doc_json } } as never)
    renderThemeLibrary()
    const apply = await screen.findByRole("button", { name: "应用到 agent简历" })
    await waitFor(() => expect(apply).toBeEnabled())
    updateLetterSpacing("0.7px")
    vi.mocked(saveTemplateStyle).mockRejectedValueOnce(new Error("save failed"))
    fireEvent.click(apply)
    await screen.findByText("主题样式保存失败，请稍后重试")
    expect(updateRevisionDocument).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText("如 0.5px")).toHaveValue("0.7px")
  })

  it("keeps the selected accent and H2 decoration when saving fails", async () => {
    renderThemeLibrary("/packs/resume/templates/classic-a4")
    expect(await screen.findByLabelText("主题演示简历预览")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("radio", { name: "标题2" }))
    fireEvent.click(screen.getByRole("radio", { name: /左线底纹/ }))
    fireEvent.click(screen.getByRole("button", { name: "主题强调色" }))
    fireEvent.click(screen.getByRole("button", { name: "#1677ff" }))

    vi.mocked(saveTemplateStyle).mockRejectedValueOnce(new Error("save failed"))
    fireEvent.click(screen.getByRole("button", { name: "保存" }))

    expect(await screen.findByText("主题样式保存失败，请稍后重试")).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: /左线底纹/ })).toBeChecked()
    expect(screen.getByText("#1677ff")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled()
  })

  it("asks before leaving a theme with unsaved style edits", async () => {
    renderThemeLibrary("/packs/resume/templates/classic-a4")

    await screen.findByLabelText("主题演示简历预览")
    vi.mocked(saveTemplateStyle).mockClear()

    updateLetterSpacing("0.5px")

    fireEvent.click(screen.getByRole("radio", { name: "简历" }))

    expect(screen.getByRole("dialog", { name: "还有未保存的主题样式" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "放弃修改并切换" }))

    expect(saveTemplateStyle).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByTestId("template-location")).toHaveTextContent("/packs/resume/workspaces"))
  })

  it("keeps the draft when cancelling a template switch", async () => {
    renderThemeLibrary("/packs/resume/templates/classic-a4")
    await screen.findByLabelText("主题演示简历预览")
    updateLetterSpacing("0.5px")
    fireEvent.click(screen.getByRole("link", { name: "编辑模板 我的黑白主题" }))
    const dialog = await screen.findByRole("dialog", { name: "还有未保存的主题样式" })
    fireEvent.click(within(dialog).getByRole("button", { name: "继续编辑" }))
    expect(screen.getByTestId("template-location")).toHaveTextContent("/packs/resume/templates/classic-a4")
    expect(screen.getByPlaceholderText("如 0.5px")).toHaveValue("0.5px")
  })

  it("does not pull the user back when a template creation finishes after switching to resumes", async () => {
    renderThemeLibrary("/packs/resume/templates/classic-a4")
    await screen.findByLabelText("主题演示简历预览")
    let finishCreation!: (style: typeof customThemeStyle) => void
    vi.mocked(saveTemplateStyle).mockImplementationOnce(() => new Promise((resolve) => { finishCreation = resolve }))
    fireEvent.click(screen.getByRole("button", { name: "新建模板" }))
    fireEvent.click(screen.getByRole("radio", { name: "简历" }))
    await screen.findByRole("heading", { name: "简历列表" })
    await act(async () => { finishCreation(customThemeStyle) })
    expect(screen.getByTestId("template-location")).toHaveTextContent("/packs/resume/workspaces")
  })

  it("stays in the template editor when saving before a mode switch fails", async () => {
    renderThemeLibrary("/packs/resume/templates/classic-a4")
    await screen.findByLabelText("主题演示简历预览")
    updateLetterSpacing("0.5px")
    vi.mocked(saveTemplateStyle).mockRejectedValueOnce(new Error("save failed"))
    fireEvent.click(screen.getByRole("radio", { name: "简历" }))
    const dialog = await screen.findByRole("dialog", { name: "还有未保存的主题样式" })
    fireEvent.click(within(dialog).getByRole("button", { name: "保存并切换" }))
    expect(await screen.findByText("主题样式保存失败，请稍后重试")).toBeInTheDocument()
    expect(screen.getByTestId("template-location")).toHaveTextContent("/packs/resume/templates/classic-a4")
    expect(screen.getByRole("dialog")).toBeInTheDocument()
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

  it("switches between custom and default templates directly from the sidebar", async () => {
    renderThemeLibrary()
    await screen.findByLabelText("主题演示简历预览")
    fireEvent.click(screen.getByRole("link", { name: "编辑模板 我的黑白主题" }))
    expect(await screen.findByRole("heading", { name: "我的黑白主题" })).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "选择主题" })).toHaveTextContent("我的黑白主题")
    fireEvent.click(screen.getByRole("link", { name: "编辑模板 经典 A4" }))
    expect(await screen.findByRole("heading", { name: "经典 A4" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "重置" })).toBeInTheDocument()
  })

})
