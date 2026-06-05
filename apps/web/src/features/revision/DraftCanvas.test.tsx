import "@testing-library/jest-dom/vitest"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { forwardRef, useImperativeHandle } from "react"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { SourceResumeCanvas } from "@typedance/contracts"
import { moduleOutlineStorageKey } from "./moduleInteractions"
import { DraftCanvas } from "./DraftCanvas"

type MockEditorProps = {
  docJson: {
    content?: Array<{
      attrs?: {
        canvasNodeId?: string
        moduleId?: string
      }
      content?: Array<{ text?: string }>
    }>
  }
  moduleOutlineVisible?: boolean
  cssText?: string
  onChange: (change: { plainText: string; docJson: { type: "doc" } }) => void
  onModuleOutlineVisibleChange?: (visible: boolean) => void
  onSourceCanvasModuleChange?: (moduleId: string | null) => void
}

const editorMocks = vi.hoisted(() => ({
  props: null as MockEditorProps | null,
  scrollToCanvasNode: vi.fn(),
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
    }))

    return (
      <div className="td-editor-print-wrapper">
        <div className="ProseMirror">
          {props.docJson.content?.map((node) => (
            <p
              key={node.attrs?.canvasNodeId}
              data-canvas-node-id={node.attrs?.canvasNodeId}
              data-module-id={node.attrs?.moduleId}
              data-testid={`canvas-node-${node.attrs?.moduleId}`}
            >
              {node.content?.[0]?.text}
            </p>
          ))}
          <div className="rm-pagination-gap" />
        </div>
      </div>
    )
  }),
}))

const canvas: SourceResumeCanvas = {
  id: "canvas_1",
  document_id: "doc_1",
  old_resume_source_id: "src_1",
  doc_json: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { canvasNodeId: "node_project", sourceBlockId: "block_project", moduleId: "mod_1" },
        content: [{ type: "text", text: "负责核心链路重构。" }],
      },
      {
        type: "paragraph",
        attrs: { canvasNodeId: "node_education", sourceBlockId: "block_education", moduleId: "mod_2" },
        content: [{ type: "text", text: "软件工程专业。" }],
      },
    ],
  },
  node_map: [
    {
      canvas_node_id: "node_project",
      source_block_id: "block_project",
      node_type: "paragraph",
      text: "负责核心链路重构。",
      source_span: { line: 1 },
      module_id: "mod_1",
    },
    {
      canvas_node_id: "node_education",
      source_block_id: "block_education",
      node_type: "paragraph",
      text: "软件工程专业。",
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
  editorMocks.scrollToCanvasNode.mockReset()
  rootSize = { width: 600, height: 500 }
  sourceViewportSize = null
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

describe("DraftCanvas", () => {
  it("applies the classic template typography to the source canvas editor", () => {
    render(<DraftCanvas canvas={canvas} onChange={vi.fn()} saveStatus="idle" />)

    expect(editorMocks.props?.cssText).toContain(".td-source-resume-canvas .rm-with-pagination p")
    expect(editorMocks.props?.cssText).toContain('font-family: Quotes, -apple-system')
    expect(editorMocks.props?.cssText).toContain("font-size: 16px;")
    expect(editorMocks.props?.cssText).toContain("line-height: 1.62;")
  })

  it("activates an outline item and scrolls below the toolbar when clicked", () => {
    render(<DraftCanvas canvas={canvas} onChange={vi.fn()} saveStatus="idle" />)

    const item = screen.getByRole("button", { name: "项目经历" })
    fireEvent.click(item)

    expect(item).toHaveAttribute("aria-current", "true")
    expect(editorMocks.scrollToCanvasNode).toHaveBeenCalledWith(
      "node_project",
      { topOffset: 16 },
    )
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

    act(() => editorMocks.props?.onModuleOutlineVisibleChange?.(false))

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

    const toggle = screen.getByRole("button", { name: "折叠模块大纲" })
    fireEvent.click(toggle)

    expect(screen.getByRole("button", { name: "展开模块大纲" })).toHaveAttribute(
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

    expect(screen.getByLabelText("简历模块大纲")).toBeInTheDocument()
    expect(editorMocks.props?.moduleOutlineVisible).toBe(true)
  })

  it("restores saved outline position and expansion state", () => {
    localStorage.setItem(moduleOutlineStorageKey("doc_1"), JSON.stringify({
      visible: true,
      expanded: false,
      position: { x: 72, y: 84 },
    }))

    render(<DraftCanvas canvas={canvas} onChange={vi.fn()} saveStatus="idle" />)

    expect(screen.getByLabelText("简历模块大纲")).toHaveStyle({
      left: "72px",
      top: "84px",
    })
    expect(screen.getByRole("button", { name: "展开模块大纲" })).toBeInTheDocument()
  })

  it("persists the outline position after dragging its title bar", async () => {
    render(<DraftCanvas canvas={canvas} onChange={vi.fn()} saveStatus="idle" />)
    await waitFor(() => {
      expect(screen.getByLabelText("简历模块大纲")).toHaveStyle({
        left: "380px",
        top: "48px",
      })
    })
    const handle = screen.getByTestId("module-outline-drag-handle")
    Object.assign(handle, {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
    })

    fireEvent.pointerDown(handle, { pointerId: 7, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: -90, clientY: 62 })
    fireEvent.pointerUp(handle, { pointerId: 7, clientX: -90, clientY: 62 })

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(moduleOutlineStorageKey("doc_1")) ?? "")).toMatchObject({
        position: { x: 280, y: 100 },
      })
    })
  })

  it("uses the source canvas viewport size for the default outline position", async () => {
    sourceViewportSize = { width: 400, height: 300 }

    render(
      <div className="td-source-resume-canvas-viewport">
        <DraftCanvas canvas={canvas} onChange={vi.fn()} saveStatus="idle" />
      </div>,
    )

    await waitFor(() => {
      expect(screen.getByLabelText("简历模块大纲")).toHaveStyle({
        left: "180px",
        top: "48px",
      })
    })
  })

  it("reclamps the persisted outline position after the canvas shrinks", async () => {
    localStorage.setItem(moduleOutlineStorageKey("doc_1"), JSON.stringify({
      visible: true,
      expanded: true,
      position: { x: 380, y: 300 },
    }))
    render(<DraftCanvas canvas={canvas} onChange={vi.fn()} saveStatus="idle" />)

    rootSize = { width: 300, height: 260 }
    act(() => editorMocks.props?.onChange({
      plainText: "updated",
      docJson: { type: "doc" },
    }))

    await waitFor(() => {
      expect(screen.getByLabelText("简历模块大纲")).toHaveStyle({
        left: "92px",
        top: "100px",
      })
    })
    expect(JSON.parse(localStorage.getItem(moduleOutlineStorageKey("doc_1")) ?? "")).toMatchObject({
      position: { x: 92, y: 100 },
    })
  })

  it("keeps interaction state out of the submitted editor document", async () => {
    const onChange = vi.fn()
    render(<DraftCanvas canvas={canvas} onChange={onChange} saveStatus="idle" />)
    await waitFor(() => {
      expect(screen.getByLabelText("简历模块大纲")).toHaveStyle({
        left: "380px",
        top: "48px",
      })
    })
    act(() => editorMocks.props?.onSourceCanvasModuleChange?.("mod_1"))
    fireEvent.pointerOver(screen.getByTestId("canvas-node-mod_2"))
    expect(screen.queryByTestId("module-region-mod_2")).not.toBeInTheDocument()
    const handle = screen.getByTestId("module-outline-drag-handle")
    Object.assign(handle, {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
    })
    fireEvent.pointerDown(handle, { pointerId: 7, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: -90, clientY: 62 })
    fireEvent.pointerUp(handle, { pointerId: 7, clientX: -90, clientY: 62 })

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

    expect(screen.getByText("负责核心链路重构。")).toBeInTheDocument()
    expect(screen.getByText("保存失败")).toHaveAttribute("aria-live", "polite")
    fireEvent.click(screen.getByRole("button", { name: "重试保存" }))
    expect(onRetrySave).toHaveBeenCalledTimes(1)
  })

  it("renders all module anchors at the same outline depth", () => {
    render(<DraftCanvas canvas={canvas} onChange={vi.fn()} saveStatus="idle" />)

    expect(screen.getByRole("button", { name: "项目经历" })).toHaveClass("pl-2")
    expect(screen.getByRole("button", { name: "教育经历" })).toHaveClass("pl-2")
  })
})
