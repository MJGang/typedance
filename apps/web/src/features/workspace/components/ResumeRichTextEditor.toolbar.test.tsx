import "@testing-library/jest-dom/vitest"
import { createRef } from "react"
import { Editor } from "@tiptap/core"
import StarterKit from "@tiptap/starter-kit"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeAll, describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import {
  BlockStyle,
  ResumeRichTextEditor,
  setToolbarTextBlock,
  type ResumeRichTextEditorHandle,
} from "./ResumeRichTextEditor"

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  globalThis.ResizeObserver = ResizeObserverMock
})

describe("ResumeRichTextEditor toolbar", () => {
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

  it("scrolls a source canvas node within the editor viewport with a top offset", () => {
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
})
