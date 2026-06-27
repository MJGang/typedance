import "@testing-library/jest-dom/vitest"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { forwardRef, useImperativeHandle } from "react"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { SourceResumeCanvas } from "@typedance/contracts"
import { MICROSOFT_YAHEI_FONT_STACK } from "../templates/style-engine/fonts"
import { moduleOutlineStorageKey } from "./moduleInteractions"
import { DraftCanvas } from "./DraftCanvas"

type MockDocJson = {
  type?: "doc"
  content?: Array<{
    type?: string
    attrs?: {
      canvasNodeId?: string
      level?: number
      moduleId?: string
    }
    content?: Array<{ type?: string; text?: string }>
  }>
}

type MockEditorProps = {
  docJson: MockDocJson
  moduleOutlineVisible?: boolean
  pageMarginGuidesVisible?: boolean
  cssText?: string
  marginConfig?: {
    top: number
    bottom: number
    left: number
    right: number
  }
  onChange: (change: { plainText: string; docJson: MockDocJson }) => void
  onModuleOutlineVisibleChange?: (visible: boolean) => void
  onPageMarginGuidesVisibleChange?: (visible: boolean) => void
  onSourceCanvasModuleChange?: (moduleId: string | null) => void
}

const editorMocks = vi.hoisted(() => ({
  props: null as MockEditorProps | null,
  pageCount: 1,
  scrollToCanvasNode: vi.fn(),
  scrollToHeadingIndex: vi.fn(),
  updatePageMargins: vi.fn(),
}))

const OriginalPointerEvent = globalThis.PointerEvent

class PointerEventMock extends MouseEvent {
  pointerId: number

  constructor(type: string, properties: PointerEventInit = {}) {
    super(type, properties)
    this.pointerId = properties.pointerId ?? 0
  }
}

vi.mock("../workspace/components/ResumeRichTextEditor", () => ({
  ResumeRichTextEditor: forwardRef(function MockResumeRichTextEditor(
    props: MockEditorProps,
    ref,
  ) {
    editorMocks.props = props
    useImperativeHandle(ref, () => ({
      setColumnsCount: vi.fn(),
      setColumnsGap: vi.fn(),
      unsetColumns: vi.fn(),
      setTextSelection: vi.fn(),
      scrollToCanvasNode: editorMocks.scrollToCanvasNode,
      scrollToHeadingIndex: editorMocks.scrollToHeadingIndex,
      updatePageMargins: editorMocks.updatePageMargins,
    }))

    return (
      <div className="td-rich-editor h-full overflow-hidden" data-testid="mock-rich-editor">
        <div className="td-rich-editor-toolbar" data-testid="mock-rich-editor-toolbar" />
        <div className="td-editor-print-wrapper" data-testid="mock-editor-print-wrapper">
          <div className="ProseMirror rm-with-pagination">
            {Array.from({ length: editorMocks.pageCount }, (_, pageIndex) => (
              <div key={pageIndex} className="page" data-page-index={pageIndex}>
                {pageIndex === 0 ? props.docJson.content?.map((node, index) => (
                  <p
                    key={node.attrs?.canvasNodeId ?? `${node.type ?? "node"}-${index}`}
                    data-canvas-node-id={node.attrs?.canvasNodeId}
                    data-module-id={node.attrs?.moduleId}
                    data-testid={`canvas-node-${node.attrs?.moduleId}`}
                  >
                    {node.content?.[0]?.text}
                  </p>
                )) : null}
              </div>
            ))}
            <div className="rm-pagination-gap" />
          </div>
        </div>
      </div>
    )
  }),
}))

const canvas: SourceResumeCanvas = {
  id: "canvas_1",
  document_id: "doc_1",
  old_resume_source_id: "src_1",
  version: 1,
  source_snapshot_hash: "sha256:seed",
  doc_json: {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { canvasNodeId: "node_project", level: 2, moduleId: "mod_1" },
        content: [{ type: "text", text: "项目经历" }],
      },
      {
        type: "heading",
        attrs: { canvasNodeId: "node_education", level: 2, moduleId: "mod_2" },
        content: [{ type: "text", text: "教育经历" }],
      },
    ],
  },
  node_map: [
    {
      canvas_node_id: "node_project",
      source_block_id: "block_project",
      node_type: "heading",
      text: "项目经历",
      source_span: { line: 1 },
      module_id: "mod_1",
    },
    {
      canvas_node_id: "node_education",
      source_block_id: "block_education",
      node_type: "heading",
      text: "教育经历",
      source_span: { line: 2 },
      module_id: "mod_2",
    },
  ],
  module_anchors: [
    {
      module_id: "mod_1",
      canvas_node_ids: ["node_project"],
      title: "项目经历",
      order: 0,
    },
    {
      module_id: "mod_2",
      canvas_node_ids: ["node_education"],
      title: "教育经历",
      order: 1,
    },
  ],
  created_at: "2026-05-21T08:00:00.000Z",
  updated_at: "2026-05-21T08:00:00.000Z",
}

let rootSize = { width: 600, height: 500 }
let sourceViewportSize: { width: number; height: number } | null = null
let paginationPageSize = { width: 794, height: 1123 }
let paginationTop = 140
let editorPrintWrapperTop = 140
let editorToolbarBottom = 128

function rect({
  left,
  top,
  width,
  height,
}: {
  left: number
  top: number
  width: number
  height: number
}) {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  } as DOMRect
}

beforeAll(() => {
  globalThis.PointerEvent = PointerEventMock as typeof PointerEvent
})

beforeEach(() => {
  localStorage.clear()
  editorMocks.props = null
  editorMocks.pageCount = 1
  editorMocks.scrollToCanvasNode.mockReset()
  editorMocks.scrollToHeadingIndex.mockReset()
  editorMocks.updatePageMargins.mockReset()
  rootSize = { width: 600, height: 500 }
  sourceViewportSize = null
  paginationPageSize = { width: 794, height: 1123 }
  paginationTop = 140
  editorPrintWrapperTop = 140
  editorToolbarBottom = 128
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(function scrollTo(this: HTMLElement, options?: ScrollToOptions | number, y?: number) {
      if (typeof options === "object" && typeof options.top === "number") {
        this.scrollTop = options.top
        return
      }
      if (typeof y === "number") {
        this.scrollTop = y
      }
    }),
  })
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains("td-source-resume-canvas-viewport") && sourceViewportSize) {
      return rect({ left: 40, top: 90, ...sourceViewportSize })
    }
    if (this.classList.contains("td-source-resume-canvas")) {
      return rect({ left: 50, top: 100, ...rootSize })
    }
    if (this.getAttribute("aria-label") === "简历模块大纲") {
      return rect({ left: 0, top: 0, width: 208, height: 160 })
    }
    if (this.classList.contains("td-rich-editor-toolbar")) {
      return rect({ left: 50, top: 100, width: rootSize.width, height: editorToolbarBottom - 100 })
    }
    if (this.classList.contains("td-editor-print-wrapper")) {
      return rect({ left: 50, top: editorPrintWrapperTop, width: rootSize.width, height: rootSize.height - 40 })
    }
    if (this.classList.contains("page")) {
      const pageIndex = Number.parseInt(this.dataset.pageIndex ?? "0", 10) || 0
      const scrollTop = document.querySelector<HTMLElement>(".td-editor-print-wrapper")?.scrollTop ?? 0
      return rect({
        left: 80,
        top: paginationTop
          + (pageIndex + 1) * paginationPageSize.height
          + pageIndex * 28
          - scrollTop,
        ...paginationPageSize,
      })
    }
    if (this.classList.contains("rm-with-pagination")) {
      const scrollTop = document.querySelector<HTMLElement>(".td-editor-print-wrapper")?.scrollTop ?? 0
      return rect({
        left: 80,
        top: paginationTop - scrollTop,
        width: 794,
        height: editorMocks.pageCount * (paginationPageSize.height + 28),
      })
    }
    if (this.dataset.canvasNodeId === "node_project") {
      return rect({ left: 90, top: 160, width: 460, height: 100 })
    }
    if (this.dataset.canvasNodeId === "node_education") {
      return rect({ left: 90, top: 300, width: 460, height: 44 })
    }
    if (this.classList.contains("rm-pagination-gap")) {
      return rect({ left: 50, top: 200, width: 600, height: 24 })
    }
    return rect({ left: 0, top: 0, width: 0, height: 0 })
  })
})

afterAll(() => {
  globalThis.PointerEvent = OriginalPointerEvent
})

afterEach(() => {
  vi.restoreAllMocks()
})

function showPageMarginGuides() {
  act(() => editorMocks.props?.onPageMarginGuidesVisibleChange?.(true))
}

describe("DraftCanvas", () => {
  it("applies the classic template typography to the source canvas editor", () => {
    render(<DraftCanvas canvas={canvas} onChange={vi.fn()} saveStatus="idle" />)

    expect(editorMocks.props?.cssText).toContain(".td-source-resume-canvas .rm-with-pagination p")
    expect(editorMocks.props?.cssText).toContain(`font-family: ${MICROSOFT_YAHEI_FONT_STACK};`)
    expect(editorMocks.props?.cssText).toContain("font-size: 16px;")
    expect(editorMocks.props?.cssText).toContain("line-height: 1.62;")
  })

  it("flashes changed canvas nodes after an applied AI patch", async () => {
    render(
      <DraftCanvas
        canvas={canvas}
        patchFlash={{ sequence: 1, canvasNodeIds: ["node_project"] }}
        onChange={vi.fn()}
        saveStatus="idle"
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId("canvas-node-mod_1")).toHaveClass("td-ai-canvas-flash")
    })
    expect(screen.getByTestId("canvas-node-mod_2")).not.toHaveClass("td-ai-canvas-flash")
  })

  it("shows draggable page margin guides with px labels", () => {
    render(<DraftCanvas canvas={canvas} onChange={vi.fn()} saveStatus="idle" />)

    expect(editorMocks.props?.marginConfig).toEqual({
      top: 76,
      bottom: 76,
      left: 50,
      right: 50,
    })
    expect(editorMocks.props?.pageMarginGuidesVisible).toBe(false)
    expect(screen.queryByRole("group", { name: "页面边距辅助线" })).not.toBeInTheDocument()

    showPageMarginGuides()

    expect(editorMocks.props?.pageMarginGuidesVisible).toBe(true)
    expect(screen.getByRole("button", { name: "拖拽上边距，当前 76px" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "拖拽下边距，当前 76px" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "拖拽左边距，当前 50px" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "拖拽右边距，当前 50px" })).toBeInTheDocument()
    const topGuide = screen.getByTestId("page-margin-guide-top")
    expect(topGuide).toHaveClass("cursor-ns-resize")
    expect(screen.getByTestId("page-margin-guide-bottom")).toHaveClass("cursor-ns-resize")
    expect(screen.getByTestId("page-margin-guide-left")).toHaveClass("cursor-ew-resize")
    expect(screen.getByTestId("page-margin-guide-right")).toHaveClass("cursor-ew-resize")

    fireEvent.pointerEnter(topGuide)
    expect(topGuide).toHaveClass("z-30")
    expect(screen.getByTestId("page-margin-guide-left")).toHaveClass("z-10")
    expect(screen.getByTestId("page-margin-guide-right")).toHaveClass("z-10")
    expect(topGuide.getAttribute("style")).toContain("linear-gradient(to bottom")
    expect(topGuide.getAttribute("style")).toContain("transparent 100%")
    expect(topGuide.className).not.toContain("border")
    fireEvent.pointerLeave(topGuide)
    expect(topGuide).toHaveClass("z-10")
    expect(topGuide.getAttribute("style")).not.toContain("linear-gradient")
  })

  it("measures the A4 page from the paginated editor when pagination decorations have no box", () => {
    paginationPageSize = { width: 0, height: 0 }

    render(<DraftCanvas canvas={canvas} onChange={vi.fn()} saveStatus="idle" />)
    showPageMarginGuides()

    expect(screen.getByRole("group", { name: "页面边距辅助线" })).toHaveStyle({
      left: "30px",
      top: "40px",
      width: "794px",
      height: "1123px",
    })
    expect(screen.getByRole("button", { name: "拖拽左边距，当前 50px" })).toBeInTheDocument()
  })

  it("renders page navigation outside the right edge of the A4 page and jumps pages", async () => {
    editorMocks.pageCount = 3
    sourceViewportSize = { width: 1200, height: 500 }
    rootSize = { width: 1200, height: 500 }

    render(
      <div className="td-source-resume-canvas-viewport">
        <DraftCanvas canvas={canvas} onChange={vi.fn()} saveStatus="idle" />
      </div>,
    )

    const navigator = await screen.findByTestId("source-page-navigator")
    const shell = screen.getByTestId("source-page-navigator-shell")
    expect(navigator).toHaveAccessibleName("页面跳转")
    await waitFor(() => {
      expect(shell).toHaveStyle({ left: "840px", top: "40px" })
    })
    expect(screen.getByTestId("source-page-navigator-page-1")).toHaveAttribute("aria-current", "page")

    fireEvent.click(screen.getByTestId("source-page-navigator-page-3"))

    expect(screen.getByTestId("mock-editor-print-wrapper")).toHaveProperty("scrollTop", 2258)
    expect(screen.getByTestId("source-page-navigator-page-3")).toHaveAttribute("aria-current", "page")

    fireEvent.click(screen.getByTestId("source-page-navigator-page-1"))

    expect(screen.getByTestId("mock-editor-print-wrapper")).toHaveProperty("scrollTop", 0)
    expect(screen.getByTestId("source-page-navigator-page-1")).toHaveAttribute("aria-current", "page")
  })

  it("updates page margins while dragging a guide without submitting editor content", async () => {
    const onChange = vi.fn()
    render(<DraftCanvas canvas={canvas} onChange={onChange} saveStatus="idle" />)
    showPageMarginGuides()
    const leftGuide = screen.getByRole("button", { name: "拖拽左边距，当前 50px" })
    Object.assign(leftGuide, {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
    })

    fireEvent.pointerDown(leftGuide, { pointerId: 11, clientX: 100, clientY: 220 })
    expect(leftGuide).toHaveAttribute("data-dragging", "true")
    expect(leftGuide.getAttribute("style")).toContain("linear-gradient(to right")
    expect(leftGuide.getAttribute("style")).toContain("rgba(224, 242, 254, 0.9)")
    expect(leftGuide.getAttribute("style")).toContain("transparent 100%")
    expect(leftGuide.className).not.toContain("border")

    fireEvent.pointerMove(leftGuide, { pointerId: 11, clientX: 120, clientY: 220 })
    fireEvent.pointerUp(leftGuide, { pointerId: 11, clientX: 120, clientY: 220 })

    expect(screen.getByRole("button", { name: "拖拽左边距，当前 70px" })).toBeInTheDocument()
    expect(leftGuide).not.toHaveAttribute("data-dragging")
    expect(leftGuide.getAttribute("style")).not.toContain("linear-gradient")
    expect(editorMocks.updatePageMargins).toHaveBeenLastCalledWith({
      top: 76,
      bottom: 76,
      left: 70,
      right: 50,
    })
    expect(onChange).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(localStorage.getItem("typedance:revision-workspace:page-margins:doc_1")).toBe(JSON.stringify({
        top: 76,
        bottom: 76,
        left: 70,
        right: 50,
      }))
    })
  })

  it("edits the numeric page margin label while keeping the px unit fixed", async () => {
    const onChange = vi.fn()
    render(<DraftCanvas canvas={canvas} onChange={onChange} saveStatus="idle" />)
    showPageMarginGuides()

    fireEvent.click(screen.getByTestId("page-margin-label-top"))

    const input = screen.getByTestId("page-margin-input-top")
    expect(input).toHaveValue("76")
    expect(screen.getByTestId("page-margin-unit-top")).toHaveTextContent("px")

    fireEvent.change(input, { target: { value: "128px" } })
    expect(input).toHaveValue("128")
    fireEvent.keyDown(input, { key: "Enter" })

    expect(screen.getByRole("button", { name: "拖拽上边距，当前 128px" })).toBeInTheDocument()
    expect(editorMocks.updatePageMargins).toHaveBeenLastCalledWith({
      top: 128,
      bottom: 76,
      left: 50,
      right: 50,
    })
    expect(onChange).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(localStorage.getItem("typedance:revision-workspace:page-margins:doc_1")).toBe(JSON.stringify({
        top: 128,
        bottom: 76,
        left: 50,
        right: 50,
      }))
    })
  })

  it("raises the active margin guide above crossing guides while dragging", () => {
    render(<DraftCanvas canvas={canvas} onChange={vi.fn()} saveStatus="idle" />)
    showPageMarginGuides()
    const topGuide = screen.getByTestId("page-margin-guide-top")
    Object.assign(topGuide, {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
    })

    fireEvent.pointerDown(topGuide, { pointerId: 12, clientX: 260, clientY: 180 })

    expect(topGuide).toHaveAttribute("data-dragging", "true")
    expect(topGuide).toHaveClass("z-30")
    expect(screen.getByTestId("page-margin-guide-left")).toHaveClass("z-10")
    expect(screen.getByTestId("page-margin-guide-right")).toHaveClass("z-10")

    fireEvent.pointerUp(topGuide, { pointerId: 12, clientX: 260, clientY: 180 })

    expect(topGuide).not.toHaveAttribute("data-dragging")
    expect(topGuide).toHaveClass("z-10")
  })

  it("activates an outline item and scrolls below the toolbar when clicked", () => {
    render(<DraftCanvas canvas={canvas} onChange={vi.fn()} saveStatus="idle" />)

    const item = screen.getByRole("button", { name: "项目经历" })
    fireEvent.click(item)

    expect(editorMocks.scrollToHeadingIndex).toHaveBeenCalledWith(
      0,
      { topOffset: 16 },
    )
    expect(editorMocks.scrollToCanvasNode).not.toHaveBeenCalled()
  })

  it("collapses the outline to its icon after an outline item scrolls the canvas", () => {
    render(<DraftCanvas canvas={canvas} onChange={vi.fn()} saveStatus="idle" />)

    fireEvent.click(screen.getByRole("button", { name: "项目经历" }))

    expect(editorMocks.scrollToHeadingIndex).toHaveBeenCalledWith(0, { topOffset: 16 })
    expect(screen.getByTestId("module-outline-panel")).toHaveClass("size-8")
    expect(screen.queryByRole("button", { name: "项目经历" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "展开大纲" })).toBeInTheDocument()
  })

  it("collapses the expanded outline when the editor canvas is clicked", () => {
    render(<DraftCanvas canvas={canvas} onChange={vi.fn()} saveStatus="idle" />)

    fireEvent.pointerDown(screen.getByTestId("mock-editor-print-wrapper"))

    expect(screen.getByTestId("module-outline-panel")).toHaveClass("size-8")
    expect(screen.queryByRole("button", { name: "项目经历" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "展开大纲" })).toBeInTheDocument()
  })

  it("builds the outline from heading nodes instead of backend module anchors", () => {
    render(
      <DraftCanvas
        canvas={{
          ...canvas,
          doc_json: {
            type: "doc",
            content: [
              {
                type: "heading",
                attrs: { level: 1 },
                content: [{ type: "text", text: "个人信息" }],
              },
              {
                type: "paragraph",
                content: [{ type: "text", text: "不是大纲项" }],
              },
              {
                type: "heading",
                attrs: { level: 3 },
                content: [{ type: "text", text: "TypeDance" }],
              },
            ],
          },
          module_anchors: [
            {
              module_id: "backend-only",
              canvas_node_ids: ["backend-node"],
              title: "后端返回模块",
              order: 0,
            },
          ],
        }}
        onChange={vi.fn()}
        saveStatus="idle"
      />,
    )

    expect(screen.getByRole("button", { name: "个人信息" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "TypeDance" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "不是大纲项" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "后端返回模块" })).not.toBeInTheDocument()
  })

  it("updates the outline immediately when headings are pasted or deleted", () => {
    render(<DraftCanvas canvas={canvas} onChange={vi.fn()} saveStatus="idle" />)

    act(() => editorMocks.props?.onChange({
      plainText: "个人信息\n\nTypeDance\n\n交付结果",
      docJson: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "个人信息" }],
          },
          {
            type: "heading",
            attrs: { level: 3 },
            content: [{ type: "text", text: "TypeDance" }],
          },
          {
            type: "heading",
            attrs: { level: 5 },
            content: [{ type: "text", text: "交付结果" }],
          },
        ],
      },
    }))

    expect(screen.getByRole("button", { name: "个人信息" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "TypeDance" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "交付结果" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "项目经历" })).not.toBeInTheDocument()

    act(() => editorMocks.props?.onChange({
      plainText: "只有正文",
      docJson: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "只有正文" }],
          },
        ],
      },
    }))

    expect(screen.queryByRole("button", { name: "个人信息" })).not.toBeInTheDocument()
    expect(screen.getByText("暂无可用模块大纲。")).toBeInTheDocument()
  })

  it("mirrors editor module selection into the outline and clears it for unrecognized content", () => {
    render(<DraftCanvas canvas={canvas} onChange={vi.fn()} saveStatus="idle" />)

    act(() => editorMocks.props?.onSourceCanvasModuleChange?.("mod_1"))
    expect(screen.getByRole("button", { name: "项目经历" })).toHaveAttribute(
      "aria-current",
      "true",
    )

    act(() => editorMocks.props?.onSourceCanvasModuleChange?.(null))
    expect(screen.getByRole("button", { name: "项目经历" })).not.toHaveAttribute(
      "aria-current",
    )
  })

  it("hides the outline from the toolbar without adding canvas highlight layers", async () => {
    render(<DraftCanvas canvas={canvas} onChange={vi.fn()} saveStatus="idle" />)

    act(() => editorMocks.props?.onSourceCanvasModuleChange?.("mod_1"))
    expect(screen.queryByTestId("module-region-mod_1")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "收起大纲" })).toBeInTheDocument()

    act(() => editorMocks.props?.onModuleOutlineVisibleChange?.(false))

    expect(screen.queryByRole("button", { name: "收起大纲" })).not.toBeInTheDocument()
    expect(screen.queryByLabelText("简历模块大纲")).not.toBeInTheDocument()
    expect(screen.queryByTestId("module-region-mod_1")).not.toBeInTheDocument()

    act(() => editorMocks.props?.onModuleOutlineVisibleChange?.(true))
    expect(screen.getByRole("button", { name: "项目经历" })).toHaveAttribute(
      "aria-current",
      "true",
    )
  })

  it("keeps active outline state without highlighting hovered canvas content", () => {
    render(<DraftCanvas canvas={canvas} onChange={vi.fn()} saveStatus="idle" />)

    act(() => editorMocks.props?.onSourceCanvasModuleChange?.("mod_1"))
    fireEvent.pointerOver(screen.getByTestId("canvas-node-mod_2"))

    expect(screen.getByRole("button", { name: "项目经历" })).toHaveAttribute(
      "aria-current",
      "true",
    )
    expect(screen.getByRole("button", { name: "教育经历" })).not.toHaveAttribute(
      "aria-current",
    )
    expect(screen.queryByTestId("module-region-mod_2")).not.toBeInTheDocument()
  })

  it("supports collapsing the module outline and persists the preference", async () => {
    render(<DraftCanvas canvas={canvas} onChange={vi.fn()} saveStatus="idle" />)
    await waitFor(() => expect(localStorage.getItem(moduleOutlineStorageKey("doc_1"))).not.toBeNull())

    const toggle = screen.getByRole("button", { name: "收起大纲" })
    fireEvent.click(toggle)

    expect(screen.getByRole("button", { name: "展开大纲" })).toHaveAttribute(
      "aria-expanded",
      "false",
    )
    expect(screen.queryByRole("button", { name: "项目经历" })).not.toBeInTheDocument()
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(moduleOutlineStorageKey("doc_1")) ?? "")).toMatchObject({
        expanded: false,
      })
    })
  })

  it("keeps module outline preferences isolated by document", async () => {
    const { rerender } = render(
      <DraftCanvas canvas={canvas} onChange={vi.fn()} saveStatus="idle" />,
    )
    await waitFor(() => expect(localStorage.getItem(moduleOutlineStorageKey("doc_1"))).not.toBeNull())

    act(() => editorMocks.props?.onModuleOutlineVisibleChange?.(false))
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(moduleOutlineStorageKey("doc_1")) ?? "")).toMatchObject({
        visible: false,
      })
    })

    rerender(
      <DraftCanvas
        canvas={{ ...canvas, id: "canvas_2", document_id: "doc_2" }}
        onChange={vi.fn()}
        saveStatus="idle"
      />,
    )

    expect(screen.getByTestId("module-outline-shell")).toBeInTheDocument()
    expect(screen.getByLabelText("简历模块大纲")).toBeInTheDocument()
    expect(editorMocks.props?.moduleOutlineVisible).toBe(true)
  })

  it("restores saved outline visibility and expansion state", () => {
    localStorage.setItem(moduleOutlineStorageKey("doc_1"), JSON.stringify({
      visible: true,
      expanded: false,
      position: { x: 72, y: 84 },
    }))

    render(<DraftCanvas canvas={canvas} onChange={vi.fn()} saveStatus="idle" />)

    expect(screen.getByTestId("module-outline-shell")).toBeInTheDocument()
    expect(screen.getByLabelText("简历模块大纲")).toBeInTheDocument()
    expect(screen.getByTestId("module-outline-panel")).toHaveClass("size-8")
    expect(screen.queryByTestId("module-outline-row-module-1")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "展开大纲" })).toBeInTheDocument()
  })

  it("docks the outline and reserves left-side space when the A4 page can still fit", async () => {
    sourceViewportSize = { width: 1200, height: 500 }

    render(
      <div className="td-source-resume-canvas-viewport">
        <DraftCanvas canvas={canvas} onChange={vi.fn()} saveStatus="idle" />
      </div>,
    )

    const root = screen.getByTestId("module-outline-shell").closest(".td-source-resume-canvas")
    await waitFor(() => {
      expect(root).toHaveAttribute("data-outline-layout", "docked")
      expect(root).toHaveAttribute("data-outline-expanded", "true")
      expect(root?.getAttribute("style")).toContain("--td-module-outline-reserved-width: 288px")
    })
    expect(screen.getByTestId("module-outline-shell")).toHaveAttribute("data-layout", "docked")
    expect(screen.getByTestId("module-outline-shell")).toHaveStyle({ top: "40px" })
    expect(screen.getByTestId("module-outline-shell").getAttribute("style")).toContain(
      "--td-module-outline-panel-width: 264px",
    )
  })

  it("keeps the toolbar outside the canvas scroll container", () => {
    render(
      <div className="td-source-resume-canvas-viewport">
        <DraftCanvas canvas={canvas} onChange={vi.fn()} saveStatus="idle" />
      </div>,
    )

    const root = screen.getByTestId("module-outline-shell").closest(".td-source-resume-canvas")
    expect(root).toHaveClass("h-full", "overflow-hidden")
    expect(screen.getByTestId("mock-rich-editor")).toHaveClass("h-full", "overflow-hidden")
    expect(screen.getByTestId("mock-rich-editor-toolbar")).not.toBe(
      screen.getByTestId("mock-editor-print-wrapper"),
    )
    expect(screen.getByTestId("mock-editor-print-wrapper")).toHaveClass(
      "td-editor-print-wrapper",
    )
  })

  it("uses a floating glass outline when the viewport cannot fit the minimum outline beside A4", async () => {
    sourceViewportSize = { width: 900, height: 500 }

    render(
      <div className="td-source-resume-canvas-viewport">
        <DraftCanvas canvas={canvas} onChange={vi.fn()} saveStatus="idle" />
      </div>,
    )

    const root = screen.getByTestId("module-outline-shell").closest(".td-source-resume-canvas")
    await waitFor(() => {
      expect(root).toHaveAttribute("data-outline-layout", "floating")
      expect(root).not.toHaveAttribute("data-outline-expanded")
      expect(root?.getAttribute("style")).toContain("--td-module-outline-reserved-width: 0px")
    })
    expect(screen.getByTestId("module-outline-shell")).toHaveAttribute("data-layout", "floating")
    expect(screen.getByTestId("module-outline-shell")).toHaveStyle({ top: "40px" })
    expect(screen.getByTestId("module-outline-panel")).toHaveClass("backdrop-blur-xl")
  })

  it("keeps the outline below the toolbar when the canvas content is scrolled", async () => {
    sourceViewportSize = { width: 1200, height: 500 }
    paginationTop = 100
    editorPrintWrapperTop = 140

    render(
      <div className="td-source-resume-canvas-viewport">
        <DraftCanvas canvas={canvas} onChange={vi.fn()} saveStatus="idle" />
      </div>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("module-outline-shell")).toHaveStyle({ top: "40px" })
    })
  })

  it("keeps the outline bottom gap equal to the top toolbar gap as the canvas resizes", async () => {
    sourceViewportSize = { width: 1200, height: 500 }
    rootSize = { width: 1200, height: 500 }
    editorToolbarBottom = 128
    editorPrintWrapperTop = 140

    render(
      <div className="td-source-resume-canvas-viewport">
        <DraftCanvas canvas={canvas} onChange={vi.fn()} saveStatus="idle" />
      </div>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("module-outline-shell").getAttribute("style")).toContain(
        "--td-module-outline-max-height: 448px",
      )
    })

    rootSize = { width: 1200, height: 360 }
    act(() => editorMocks.props?.onChange({
      plainText: "resized",
      docJson: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: " resized heading" }],
          },
        ],
      },
    }))

    await waitFor(() => {
      expect(screen.getByTestId("module-outline-shell").getAttribute("style")).toContain(
        "--td-module-outline-max-height: 308px",
      )
    })
  })

  it("switches the outline from docked to floating when the source viewport shrinks", async () => {
    sourceViewportSize = { width: 1200, height: 500 }
    render(
      <div className="td-source-resume-canvas-viewport">
        <DraftCanvas canvas={canvas} onChange={vi.fn()} saveStatus="idle" />
      </div>,
    )
    const root = screen.getByTestId("module-outline-shell").closest(".td-source-resume-canvas")
    await waitFor(() => expect(root).toHaveAttribute("data-outline-layout", "docked"))

    sourceViewportSize = { width: 900, height: 500 }
    act(() => editorMocks.props?.onChange({
      plainText: "updated",
      docJson: { type: "doc" },
    }))

    await waitFor(() => {
      expect(root).toHaveAttribute("data-outline-layout", "floating")
      expect(root).not.toHaveAttribute("data-outline-expanded")
      expect(root?.getAttribute("style")).toContain("--td-module-outline-reserved-width: 0px")
    })
  })

  it("keeps interaction state out of the submitted editor document", async () => {
    const onChange = vi.fn()
    render(<DraftCanvas canvas={canvas} onChange={onChange} saveStatus="idle" />)
    act(() => editorMocks.props?.onSourceCanvasModuleChange?.("mod_1"))
    fireEvent.pointerOver(screen.getByTestId("canvas-node-mod_2"))
    expect(screen.queryByTestId("module-region-mod_2")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "收起大纲" }))

    const docJson = {
      type: "doc" as const,
      content: [{ type: "paragraph", content: [{ type: "text", text: "原始正文" }] }],
    }
    act(() => editorMocks.props?.onChange({ plainText: "原始正文", docJson }))

    expect(onChange).toHaveBeenCalledWith({ plainText: "原始正文", docJson })
    expect(JSON.stringify(onChange.mock.calls[onChange.mock.calls.length - 1]?.[0].docJson)).not.toMatch(
      /activeModuleId|outline|position/,
    )
  })

  it("announces save failures without hiding the original canvas", () => {
    const onRetrySave = vi.fn()
    render(<DraftCanvas canvas={canvas} onChange={vi.fn()} onRetrySave={onRetrySave} saveStatus="error" />)

    expect(screen.getByTestId("canvas-node-mod_1")).toBeInTheDocument()
    expect(screen.getByText("保存失败")).toHaveAttribute("aria-live", "polite")
    fireEvent.click(screen.getByRole("button", { name: "重试保存" }))
    expect(onRetrySave).toHaveBeenCalledTimes(1)
  })

  it("renders all module anchors at the same outline depth", () => {
    render(<DraftCanvas canvas={canvas} onChange={vi.fn()} saveStatus="idle" />)

    expect(screen.getByRole("button", { name: "项目经历" })).toHaveStyle({ paddingLeft: "10px" })
    expect(screen.getByRole("button", { name: "教育经历" })).toHaveStyle({ paddingLeft: "10px" })
  })
})
