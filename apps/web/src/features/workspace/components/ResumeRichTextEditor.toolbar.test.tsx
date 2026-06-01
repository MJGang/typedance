import "@testing-library/jest-dom/vitest"
import { createRef } from "react"
import { Editor } from "@tiptap/core"
import StarterKit from "@tiptap/starter-kit"
import { render, screen } from "@testing-library/react"
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

    expect(() => cachedHandle?.scrollToCanvasNode("node_1")).not.toThrow()
  })
})
