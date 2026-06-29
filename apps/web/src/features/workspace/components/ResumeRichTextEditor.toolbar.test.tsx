import "@testing-library/jest-dom/vitest"
import { createRef } from "react"
import { Editor } from "@tiptap/core"
import StarterKit from "@tiptap/starter-kit"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeAll, describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import {
  BlockStyle,
  getDragHandleBlockPresentation,
  getDragHandleBlockType,
  isPointerWithinDragHandleBlock,
  ResumeRichTextEditor,
  setToolbarTextBlock,
  type ResumeRichTextEditorHandle,
} from "./ResumeRichTextEditor"

vi.mock("@typedance/resume-markdown", () => ({
  markdownToResumeDocJson: vi.fn(() => {
    throw new Error("PasteMarkdown should use the editor Markdown API")
  }),
}))

type TestJsonNode = {
  type?: string
  text?: string
  content?: TestJsonNode[]
}

function collectNodeText(node: TestJsonNode): string {
  return [
    node.text ?? "",
    ...(node.content ?? []).map(collectNodeText),
  ].join("")
}

function hasNestedListPath(node: TestJsonNode, path: string[]): boolean {
  if (path.length === 0) return true

  const [currentType, ...rest] = path
  if (node.type === currentType && (rest.length === 0 || (node.content ?? []).some((child) => hasNestedListPath(child, rest)))) {
    return true
  }

  return (node.content ?? []).some((child) => hasNestedListPath(child, path))
}

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  globalThis.ResizeObserver = ResizeObserverMock
})

describe("ResumeRichTextEditor toolbar", () => {
  it("keeps the editor mounted while the format toolbar is hidden", () => {
    render(
      <TooltipProvider>
        <ResumeRichTextEditor
          ariaLabel="Resume text"
          docJson={{ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "正文" }] }] }}
          toolbarVisible={false}
          onChange={() => {}}
        />
      </TooltipProvider>,
    )

    expect(screen.queryByRole("toolbar", { name: "简历格式工具栏" })).not.toBeInTheDocument()
    expect(screen.getByLabelText("Resume text")).toBeInTheDocument()
  })

  it("toggles the page navigator from the format toolbar", () => {
    const onPageNavigatorVisibleChange = vi.fn()
    render(
      <TooltipProvider>
        <ResumeRichTextEditor
          ariaLabel="Resume text"
          docJson={{ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "正文" }] }] }}
          pageNavigatorVisible={false}
          onPageNavigatorVisibleChange={onPageNavigatorVisibleChange}
          onChange={() => {}}
        />
      </TooltipProvider>,
    )

    const button = screen.getByRole("button", { name: "分页器" })
    expect(button).toHaveAttribute("aria-pressed", "false")
    fireEvent.click(button)
    expect(onPageNavigatorVisibleChange).toHaveBeenCalledWith(true)
  })

  it("renders a supplied end action inside the toolbar", () => {
    render(
      <TooltipProvider>
        <ResumeRichTextEditor
          ariaLabel="Resume text"
          docJson={{ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "正文" }] }] }}
          onChange={() => {}}
          toolbarEnd={<button type="button">尾部操作</button>}
        />
      </TooltipProvider>,
    )

    const toolbar = screen.getByRole("toolbar", { name: "简历格式工具栏" })
    expect(within(toolbar).getByRole("button", { name: "尾部操作" })).toBeInTheDocument()
  })

  it("renders the updated toolbar labels and grouped separators", () => {
    render(
      <TooltipProvider>
        <ResumeRichTextEditor
          ariaLabel="Resume text"
          docJson={{ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "正文" }] }] }}
          onChange={() => {}}
        />
      </TooltipProvider>,
    )

    expect(screen.getByRole("button", { name: "正文与标题" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "正文与标题" }).querySelector(".lucide-type")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "正文与标题" }).querySelector(".lucide-pilcrow")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "字号" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "下划线" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "行高调整" }).querySelector(".lucide-list-collapse")).toBeInTheDocument()
    expect(screen.getAllByRole("separator")).toHaveLength(4)
    expect(screen.getAllByText("|")).toHaveLength(4)
    expect(screen.queryByRole("button", { name: "模块大纲" })).not.toBeInTheDocument()
  })

  it("renders an active module outline toggle when its callback is provided", () => {
    const onModuleOutlineVisibleChange = vi.fn()

    render(
      <TooltipProvider>
        <ResumeRichTextEditor
          ariaLabel="Resume text"
          docJson={{ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "正文" }] }] }}
          onChange={() => {}}
          moduleOutlineVisible
          onModuleOutlineVisibleChange={onModuleOutlineVisibleChange}
        />
      </TooltipProvider>,
    )

    const button = screen.getByRole("button", { name: "模块大纲" })
    expect(button.querySelector(".lucide-list-tree")).toBeInTheDocument()
    expect(button).toHaveAttribute("data-active", "true")

    fireEvent.click(button)

    expect(onModuleOutlineVisibleChange).toHaveBeenCalledWith(false)
  })

  it("renders a page margin guide toggle in the toolbar", () => {
    const onPageMarginGuidesVisibleChange = vi.fn()

    render(
      <TooltipProvider>
        <ResumeRichTextEditor
          ariaLabel="Resume text"
          docJson={{ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "正文" }] }] }}
          onChange={() => {}}
          pageMarginGuidesVisible
          onPageMarginGuidesVisibleChange={onPageMarginGuidesVisibleChange}
        />
      </TooltipProvider>,
    )

    const button = screen.getByRole("button", { name: "页面边距辅助线" })
    expect(button.querySelector(".lucide-hash")).toBeInTheDocument()
    expect(button).toHaveAttribute("data-active", "true")

    fireEvent.click(button)

    expect(onPageMarginGuidesVisibleChange).toHaveBeenCalledWith(false)
  })

  it("does not add extra content spacing when explicit page margins are provided", async () => {
    render(
      <TooltipProvider>
        <ResumeRichTextEditor
          ariaLabel="Resume text"
          docJson={{ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "正文" }] }] }}
          marginConfig={{ top: 76, bottom: 76, left: 50, right: 50 }}
          onChange={() => {}}
        />
      </TooltipProvider>,
    )

    await waitFor(() => {
      const editor = document.querySelector<HTMLElement>(".rm-with-pagination")
      expect(editor).not.toBeNull()
      expect(editor?.style.getPropertyValue("--rm-margin-top")).toBe("76px")
      expect(editor?.style.getPropertyValue("--rm-content-margin-top")).toBe("0px")
      expect(editor?.style.getPropertyValue("--rm-content-margin-bottom")).toBe("0px")
    })
  })

  it("renders a paragraph block type icon in the floating drag handle by default", () => {
    render(
      <TooltipProvider>
        <ResumeRichTextEditor
          ariaLabel="Resume text"
          docJson={{ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "正文" }] }] }}
          onChange={() => {}}
        />
      </TooltipProvider>,
    )

    const dragHandle = screen.getByTestId("resume-drag-handle")

    expect(dragHandle).toHaveAttribute("data-block-type", "paragraph")
    expect(dragHandle.querySelector(".lucide-type")).toBeInTheDocument()
    expect(dragHandle.querySelector(".lucide-grip-vertical")).toBeInTheDocument()
  })

  it("scrolls the editor print wrapper when the mouse wheel is used during block dragging", () => {
    render(
      <TooltipProvider>
        <ResumeRichTextEditor
          ariaLabel="Resume text"
          docJson={{ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Drag me" }] }] }}
          onChange={() => {}}
        />
      </TooltipProvider>,
    )

    const wrapper = document.querySelector<HTMLElement>(".td-editor-print-wrapper")
    const dragHandle = document.querySelector<HTMLElement>(".td-resume-drag-handle-floating")
    expect(wrapper).toBeInstanceOf(HTMLElement)
    expect(dragHandle).toBeInstanceOf(HTMLElement)
    Object.defineProperty(wrapper, "scrollTop", { configurable: true, writable: true, value: 120 })
    Object.defineProperty(wrapper, "scrollHeight", { configurable: true, value: 1200 })
    Object.defineProperty(wrapper, "clientHeight", { configurable: true, value: 400 })

    fireEvent.dragStart(dragHandle!)
    fireEvent.wheel(document, { deltaY: 180 })

    expect(wrapper?.scrollTop).toBe(300)

    fireEvent.dragEnd(dragHandle!)
    fireEvent.wheel(document, { deltaY: 120 })

    expect(wrapper?.scrollTop).toBe(300)
  })

  it("scrolls the editor print wrapper after pressing the drag handle before native drag starts", () => {
    render(
      <TooltipProvider>
        <ResumeRichTextEditor
          ariaLabel="Resume text"
          docJson={{ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Drag me" }] }] }}
          onChange={() => {}}
        />
      </TooltipProvider>,
    )

    const wrapper = document.querySelector<HTMLElement>(".td-editor-print-wrapper")
    const dragHandle = screen.getByTestId("resume-drag-handle")
    expect(wrapper).toBeInstanceOf(HTMLElement)
    Object.defineProperty(wrapper, "scrollTop", { configurable: true, writable: true, value: 120 })
    Object.defineProperty(wrapper, "scrollHeight", { configurable: true, value: 1200 })
    Object.defineProperty(wrapper, "clientHeight", { configurable: true, value: 400 })

    fireEvent.pointerDown(dragHandle, { button: 0, pointerId: 12 })
    fireEvent.wheel(document, { deltaY: 180 })

    expect(wrapper?.scrollTop).toBe(300)

    fireEvent.pointerUp(document, { pointerId: 12 })
    fireEvent.wheel(document, { deltaY: 120 })

    expect(wrapper?.scrollTop).toBe(300)
  })

  it("maps floating drag handle block types to icons", () => {
    const editor = new Editor({
      extensions: [StarterKit, BlockStyle],
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "正文" }] },
          { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "小标题" }] },
          {
            type: "bulletList",
            content: [{
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "列表" }] }],
            }],
          },
          {
            type: "orderedList",
            content: [{
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "编号" }] }],
            }],
          },
        ],
      },
    })

    expect(getDragHandleBlockType(editor.state.doc.child(0), editor, 0)).toBe("paragraph")
    expect(getDragHandleBlockPresentation("paragraph").iconClassName).toBe("lucide-type")

    expect(getDragHandleBlockType(editor.state.doc.child(1), editor, 4)).toBe("heading3")
    expect(getDragHandleBlockPresentation("heading3")).toMatchObject({
      iconClassName: "lucide-heading-3",
    })
    expect(getDragHandleBlockPresentation("heading3")).not.toHaveProperty("showCollapseAffordance")

    expect(getDragHandleBlockType(editor.state.doc.child(2), editor, 9)).toBe("bulletList")
    expect(getDragHandleBlockPresentation("bulletList")).toMatchObject({
      iconClassName: "lucide-list",
    })

    expect(getDragHandleBlockType(editor.state.doc.child(3), editor, 17)).toBe("orderedList")
    expect(getDragHandleBlockPresentation("orderedList")).toMatchObject({
      iconClassName: "lucide-list-ordered",
    })

    editor.destroy()
  })

  it("only shows the floating drag handle when the pointer is near the actual block", () => {
    const rect = { top: 120, bottom: 144, height: 24 }

    expect(isPointerWithinDragHandleBlock({ clientY: 116 }, rect)).toBe(true)
    expect(isPointerWithinDragHandleBlock({ clientY: 144 }, rect)).toBe(true)
    expect(isPointerWithinDragHandleBlock({ clientY: 80 }, rect)).toBe(false)
    expect(isPointerWithinDragHandleBlock({ clientY: 180 }, rect)).toBe(false)
    expect(isPointerWithinDragHandleBlock(null, rect)).toBe(false)
    expect(isPointerWithinDragHandleBlock({ clientY: 128 }, { top: 120, bottom: 120, height: 0 })).toBe(false)
  })

  it("renders source canvas attributes on paragraph nodes", () => {
    render(
      <TooltipProvider>
        <ResumeRichTextEditor
          ariaLabel="Resume text"
          docJson={{
            type: "doc",
            content: [{
              type: "paragraph",
              attrs: { canvasNodeId: "node_1", sourceBlockId: "block_1", moduleId: "mod_1" },
              content: [{ type: "text", text: "Source paragraph" }],
            }],
          }}
          onChange={() => {}}
        />
      </TooltipProvider>,
    )

    expect(screen.getByText("Source paragraph")).toHaveAttribute("data-canvas-node-id", "node_1")
    expect(screen.getByText("Source paragraph")).toHaveAttribute("data-source-block-id", "block_1")
    expect(screen.getByText("Source paragraph")).toHaveAttribute("data-module-id", "mod_1")
  })

  it("renders source canvas attributes on horizontal rule nodes", () => {
    render(
      <TooltipProvider>
        <ResumeRichTextEditor
          ariaLabel="Resume text"
          docJson={{
            type: "doc",
            content: [{
              type: "horizontalRule",
              attrs: { canvasNodeId: "node_rule", sourceBlockId: "block_rule" },
            }],
          }}
          onChange={() => {}}
        />
      </TooltipProvider>,
    )

    const rule = document.querySelector("hr")
    expect(rule).toHaveAttribute("data-canvas-node-id", "node_rule")
    expect(rule).toHaveAttribute("data-source-block-id", "block_rule")
  })

  it("notifies the source canvas module at the selection anchor without a block type listener", () => {
    const ref = createRef<ResumeRichTextEditorHandle>()
    const onSourceCanvasModuleChange = vi.fn()

    render(
      <TooltipProvider>
        <ResumeRichTextEditor
          ref={ref}
          ariaLabel="Resume text"
          docJson={{
            type: "doc",
            content: [{
              type: "paragraph",
              attrs: { moduleId: "mod_1" },
              content: [{ type: "text", text: "Source paragraph" }],
            }],
          }}
          onChange={() => {}}
          onSourceCanvasModuleChange={onSourceCanvasModuleChange}
        />
      </TooltipProvider>,
    )

    act(() => ref.current?.setTextSelection({ anchor: 2, head: 2 }))

    expect(onSourceCanvasModuleChange).toHaveBeenLastCalledWith("mod_1")
  })

  it("notifies null when the selection anchor has no source canvas module", () => {
    const ref = createRef<ResumeRichTextEditorHandle>()
    const onSourceCanvasModuleChange = vi.fn()

    render(
      <TooltipProvider>
        <ResumeRichTextEditor
          ref={ref}
          ariaLabel="Resume text"
          docJson={{
            type: "doc",
            content: [
              {
                type: "paragraph",
                attrs: { moduleId: "mod_1" },
                content: [{ type: "text", text: "First" }],
              },
              {
                type: "paragraph",
                content: [{ type: "text", text: "Second" }],
              },
            ],
          }}
          onChange={() => {}}
          onSourceCanvasModuleChange={onSourceCanvasModuleChange}
        />
      </TooltipProvider>,
    )

    act(() => ref.current?.setTextSelection({ anchor: 9, head: 9 }))

    expect(onSourceCanvasModuleChange).toHaveBeenLastCalledWith(null)
  })

  it("uses the anchor module for a backward selection across source canvas modules", () => {
    const ref = createRef<ResumeRichTextEditorHandle>()
    const onSourceCanvasModuleChange = vi.fn()

    render(
      <TooltipProvider>
        <ResumeRichTextEditor
          ref={ref}
          ariaLabel="Resume text"
          docJson={{
            type: "doc",
            content: [
              {
                type: "paragraph",
                attrs: { moduleId: "mod_1" },
                content: [{ type: "text", text: "First" }],
              },
              {
                type: "paragraph",
                attrs: { moduleId: "mod_2" },
                content: [{ type: "text", text: "Second" }],
              },
            ],
          }}
          onChange={() => {}}
          onSourceCanvasModuleChange={onSourceCanvasModuleChange}
        />
      </TooltipProvider>,
    )

    act(() => ref.current?.setTextSelection({ anchor: 9, head: 2 }))

    expect(onSourceCanvasModuleChange).toHaveBeenLastCalledWith("mod_2")
  })

  it("finds the source canvas module on a list item ancestor", () => {
    const ref = createRef<ResumeRichTextEditorHandle>()
    const onSourceCanvasModuleChange = vi.fn()

    render(
      <TooltipProvider>
        <ResumeRichTextEditor
          ref={ref}
          ariaLabel="Resume text"
          docJson={{
            type: "doc",
            content: [{
              type: "bulletList",
              content: [{
                type: "listItem",
                attrs: { moduleId: "mod_list" },
                content: [{
                  type: "paragraph",
                  content: [{ type: "text", text: "List item" }],
                }],
              }],
            }],
          }}
          onChange={() => {}}
          onSourceCanvasModuleChange={onSourceCanvasModuleChange}
        />
      </TooltipProvider>,
    )

    act(() => ref.current?.setTextSelection({ anchor: 4, head: 4 }))

    expect(onSourceCanvasModuleChange).toHaveBeenLastCalledWith("mod_list")
  })

  it("scrolls a source canvas node with CSS special characters into view", () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    })
    const ref = createRef<ResumeRichTextEditorHandle>()

    render(
      <TooltipProvider>
        <ResumeRichTextEditor
          ref={ref}
          ariaLabel="Resume text"
          docJson={{
            type: "doc",
            content: [{
              type: "paragraph",
              attrs: { canvasNodeId: "node:work/1" },
              content: [{ type: "text", text: "Work experience" }],
            }],
          }}
          onChange={() => {}}
        />
      </TooltipProvider>,
    )

    ref.current?.scrollToCanvasNode("node:work/1")

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" })
  })

  it("scrolls a source canvas node within the editor print wrapper with a top offset", () => {
    const ref = createRef<ResumeRichTextEditorHandle>()

    render(
      <TooltipProvider>
        <div className="td-source-resume-canvas-viewport">
          <ResumeRichTextEditor
            ref={ref}
            ariaLabel="Resume text"
            docJson={{
              type: "doc",
              content: [{
                type: "paragraph",
                attrs: { canvasNodeId: "node_1" },
                content: [{ type: "text", text: "Work experience" }],
              }],
            }}
            onChange={() => {}}
          />
        </div>
      </TooltipProvider>,
    )

    const canvasNode = screen.getByText("Work experience")
    const sourceViewport = canvasNode.closest(".td-source-resume-canvas-viewport")
    const printWrapper = canvasNode.closest(".td-editor-print-wrapper")
    const sourceScrollTo = vi.fn()
    const printScrollTo = vi.fn()
    expect(sourceViewport).toBeInstanceOf(HTMLElement)
    expect(printWrapper).toBeInstanceOf(HTMLElement)
    Object.defineProperty(sourceViewport, "scrollTop", { configurable: true, value: 120 })
    Object.defineProperty(printWrapper, "scrollTop", { configurable: true, value: 80 })
    Object.defineProperty(sourceViewport, "scrollTo", { configurable: true, value: sourceScrollTo })
    Object.defineProperty(printWrapper, "scrollTo", { configurable: true, value: printScrollTo })
    vi.spyOn(sourceViewport as HTMLElement, "getBoundingClientRect").mockReturnValue({ top: 100 } as DOMRect)
    vi.spyOn(printWrapper as HTMLElement, "getBoundingClientRect").mockReturnValue({ top: 180 } as DOMRect)
    vi.spyOn(canvasNode, "getBoundingClientRect").mockReturnValue({ top: 460 } as DOMRect)

    ref.current?.scrollToCanvasNode("node_1", { topOffset: 24 })

    expect(printScrollTo).toHaveBeenCalledWith({ top: 336, behavior: "smooth" })
    expect(sourceScrollTo).not.toHaveBeenCalled()
  })

  it("scrolls a heading index within the editor print wrapper with a top offset", () => {
    const ref = createRef<ResumeRichTextEditorHandle>()

    render(
      <TooltipProvider>
        <div className="td-source-resume-canvas-viewport">
          <ResumeRichTextEditor
            ref={ref}
            ariaLabel="Resume text"
            docJson={{
              type: "doc",
              content: [
                { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "项目经历" }] },
                { type: "paragraph", content: [{ type: "text", text: "Work body" }] },
                { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "TypeDance" }] },
              ],
            }}
            onChange={() => {}}
          />
        </div>
      </TooltipProvider>,
    )

    const heading = screen.getByText("TypeDance")
    const sourceViewport = heading.closest(".td-source-resume-canvas-viewport")
    const printWrapper = heading.closest(".td-editor-print-wrapper")
    const sourceScrollTo = vi.fn()
    const printScrollTo = vi.fn()
    expect(sourceViewport).toBeInstanceOf(HTMLElement)
    expect(printWrapper).toBeInstanceOf(HTMLElement)
    Object.defineProperty(sourceViewport, "scrollTop", { configurable: true, value: 120 })
    Object.defineProperty(printWrapper, "scrollTop", { configurable: true, value: 80 })
    Object.defineProperty(sourceViewport, "scrollTo", { configurable: true, value: sourceScrollTo })
    Object.defineProperty(printWrapper, "scrollTo", { configurable: true, value: printScrollTo })
    vi.spyOn(sourceViewport as HTMLElement, "getBoundingClientRect").mockReturnValue({ top: 100 } as DOMRect)
    vi.spyOn(printWrapper as HTMLElement, "getBoundingClientRect").mockReturnValue({ top: 180 } as DOMRect)
    vi.spyOn(heading, "getBoundingClientRect").mockReturnValue({ top: 460 } as DOMRect)

    ref.current?.scrollToHeadingIndex(1, { topOffset: 24 })

    expect(printScrollTo).toHaveBeenCalledWith({ top: 336, behavior: "smooth" })
    expect(sourceScrollTo).not.toHaveBeenCalled()
  })

  it("falls back to the editor print wrapper when no source viewport is present", () => {
    const ref = createRef<ResumeRichTextEditorHandle>()

    render(
      <TooltipProvider>
        <ResumeRichTextEditor
          ref={ref}
          ariaLabel="Resume text"
          docJson={{
            type: "doc",
            content: [{
              type: "paragraph",
              attrs: { canvasNodeId: "node_1" },
              content: [{ type: "text", text: "Work experience" }],
            }],
          }}
          onChange={() => {}}
        />
      </TooltipProvider>,
    )

    const canvasNode = screen.getByText("Work experience")
    const viewport = canvasNode.closest(".td-editor-print-wrapper")
    const scrollTo = vi.fn()
    expect(viewport).toBeInstanceOf(HTMLElement)
    Object.defineProperty(viewport, "scrollTop", { configurable: true, value: 120 })
    Object.defineProperty(viewport, "scrollTo", { configurable: true, value: scrollTo })
    vi.spyOn(viewport as HTMLElement, "getBoundingClientRect").mockReturnValue({ top: 100 } as DOMRect)
    vi.spyOn(canvasNode, "getBoundingClientRect").mockReturnValue({ top: 460 } as DOMRect)

    ref.current?.scrollToCanvasNode("node_1", { topOffset: 24 })

    expect(scrollTo).toHaveBeenCalledWith({ top: 456, behavior: "smooth" })
  })

  it("scrolls a source canvas node without animation when reduced motion is preferred", () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    })
    const originalMatchMedia = window.matchMedia
    window.matchMedia = vi.fn().mockReturnValue({ matches: true })
    const ref = createRef<ResumeRichTextEditorHandle>()

    try {
      render(
        <TooltipProvider>
          <ResumeRichTextEditor
            ref={ref}
            ariaLabel="Resume text"
            docJson={{
              type: "doc",
              content: [{
                type: "paragraph",
                attrs: { canvasNodeId: "node_1" },
                content: [{ type: "text", text: "Source paragraph" }],
              }],
            }}
            onChange={() => {}}
          />
        </TooltipProvider>,
      )

      ref.current?.scrollToCanvasNode("node_1")

      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "center" })
    } finally {
      window.matchMedia = originalMatchMedia
    }
  })

  it("keeps each source canvas attribute set when converting multiple paragraphs to headings", () => {
    const editor = new Editor({
      extensions: [StarterKit, BlockStyle],
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { canvasNodeId: "node_1", sourceBlockId: "block_1", moduleId: "mod_1" },
            content: [{ type: "text", text: "First" }],
          },
          {
            type: "paragraph",
            attrs: { canvasNodeId: "node_2", sourceBlockId: "block_2", moduleId: "mod_2" },
            content: [{ type: "text", text: "Second" }],
          },
        ],
      },
    })
    editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 })

    setToolbarTextBlock(editor, "heading1")

    expect(editor.getJSON().content?.filter((node) => node.type === "heading")).toMatchObject([
      {
        type: "heading",
        attrs: { level: 1, canvasNodeId: "node_1", sourceBlockId: "block_1", moduleId: "mod_1" },
      },
      {
        type: "heading",
        attrs: { level: 1, canvasNodeId: "node_2", sourceBlockId: "block_2", moduleId: "mod_2" },
      },
    ])
    editor.destroy()
  })

  it("ignores scroll requests from a cached handle after unmount", () => {
    const ref = createRef<ResumeRichTextEditorHandle>()
    const { unmount } = render(
      <TooltipProvider>
        <ResumeRichTextEditor
          ref={ref}
          ariaLabel="Resume text"
          docJson={{ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Source paragraph" }] }] }}
          onChange={() => {}}
        />
      </TooltipProvider>,
    )
    const cachedHandle = ref.current

    unmount()

    expect(() => {
      cachedHandle?.setTextSelection({ anchor: 1, head: 1 })
      cachedHandle?.scrollToCanvasNode("node_1")
    }).not.toThrow()
  })

  it("preserves the active text selection when external content is synchronized", async () => {
    const ref = createRef<ResumeRichTextEditorHandle>()
    const onSelectionUpdate = vi.fn()
    const { rerender } = render(
      <TooltipProvider>
        <ResumeRichTextEditor
          ref={ref}
          ariaLabel="Resume text"
          docJson={{
            type: "doc",
            content: [
              { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Current section" }] },
              { type: "paragraph", content: [{ type: "text", text: "Original trailing content" }] },
            ],
          }}
          onChange={() => {}}
          onSelectionUpdate={onSelectionUpdate}
        />
      </TooltipProvider>,
    )

    act(() => ref.current?.setTextSelection({ anchor: 3, head: 3 }))
    await waitFor(() => expect(onSelectionUpdate).toHaveBeenLastCalledWith("heading2"))

    rerender(
      <TooltipProvider>
        <ResumeRichTextEditor
          ref={ref}
          ariaLabel="Resume text"
          docJson={{
            type: "doc",
            content: [
              { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Current section" }] },
              { type: "paragraph", content: [{ type: "text", text: "Saved trailing content" }] },
            ],
          }}
          onChange={() => {}}
          onSelectionUpdate={onSelectionUpdate}
        />
      </TooltipProvider>,
    )

    await waitFor(() => expect(onSelectionUpdate).toHaveBeenLastCalledWith("heading2"))
  })

  it("pastes Markdown lists through the editor Markdown API without keeping raw markers", async () => {
    const onChange = vi.fn()

    const { unmount } = render(
      <TooltipProvider>
        <ResumeRichTextEditor
          ariaLabel="Resume text"
          docJson={{ type: "doc", content: [{ type: "paragraph" }] }}
          onChange={onChange}
        />
      </TooltipProvider>,
    )

    try {
      fireEvent.paste(screen.getByLabelText("Resume text"), {
        clipboardData: {
          getData: (type: string) => type === "text/plain"
            ? [
                "1. First ordered",
                "   1. Second ordered",
                "      1. Third ordered",
                "",
                "- First bullet",
                "  - Second bullet",
                "    - Third bullet",
              ].join("\n")
            : "",
        },
      })

      await waitFor(() => expect(onChange).toHaveBeenCalled())

      const change = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0]
      expect(change?.docJson).toBeDefined()
      expect(hasNestedListPath(change.docJson, ["orderedList", "orderedList", "orderedList"])).toBe(true)
      expect(hasNestedListPath(change.docJson, ["bulletList", "bulletList", "bulletList"])).toBe(true)
      expect(collectNodeText(change.docJson)).not.toMatch(/(?:^|\n|\s)(?:1\.|-)\s/)
    } finally {
      unmount()
    }
  })
})
