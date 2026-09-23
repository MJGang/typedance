import { createElement } from "react"
import { Editor } from "@tiptap/core"
import StarterKit from "@tiptap/starter-kit"
import { Column, Columns } from "@typedance/tiptap-layout"
import { render, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { defaultClassicA4Style } from "../../templates/data"
import { clearDuplicateCanvasNodeIds } from "../editor"
import { BlockStyle, ResumeRichTextEditor } from "./ResumeRichTextEditor"

function sourceNodes(editor: Editor) {
  const nodes: Array<{ text: string; canvasNodeId: unknown; sourceBlockId: unknown }> = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === "heading") {
      nodes.push({
        text: node.textContent,
        canvasNodeId: node.attrs.canvasNodeId,
        sourceBlockId: node.attrs.sourceBlockId,
      })
    }
  })
  return nodes
}

describe("source canvas node identities", () => {
  it("queues a repaired document when entering with duplicate source identities", async () => {
    const onChange = vi.fn()
    render(createElement(TooltipProvider, null, createElement(ResumeRichTextEditor, {
      ariaLabel: "Resume text",
      templateStyle: defaultClassicA4Style,
      docJson: {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 3, canvasNodeId: "node_work", sourceBlockId: "block_work" }, content: [{ type: "text", text: "公司" }] },
          { type: "heading", attrs: { level: 3, canvasNodeId: "node_work", sourceBlockId: "block_work" }, content: [{ type: "text", text: "职位" }] },
        ],
      },
      onChange,
    })))

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const repaired = onChange.mock.lastCall?.[0].docJson
    expect(repaired.content?.[0].attrs.canvasNodeId).toBe("node_work")
    expect(repaired.content?.[1].attrs.canvasNodeId).toBeNull()
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it("repairs an already failed two-column document without changing its layout or text", () => {
    const docJson = {
      type: "doc" as const,
      content: [{
        type: "columns",
        attrs: { count: 2 },
        content: [
          {
            type: "column",
            content: [{ type: "heading", attrs: { canvasNodeId: "node_work", sourceBlockId: "block_work" }, content: [{ type: "text", text: "公司" }] }],
          },
          {
            type: "column",
            content: [{ type: "heading", attrs: { canvasNodeId: "node_work", sourceBlockId: "block_work" }, content: [{ type: "text", text: "职位" }] }],
          },
        ],
      }],
    }

    const repaired = clearDuplicateCanvasNodeIds(docJson)

    expect(repaired.content?.[0].attrs).toEqual({ count: 2 })
    expect(repaired.content?.[0].content?.[0].content?.[0]).toMatchObject({
      attrs: { canvasNodeId: "node_work", sourceBlockId: "block_work" },
      content: [{ text: "公司" }],
    })
    expect(repaired.content?.[0].content?.[1].content?.[0]).toMatchObject({
      attrs: { canvasNodeId: null, sourceBlockId: null },
      content: [{ text: "职位" }],
    })
    expect(docJson.content[0].content[1].content[0].attrs.canvasNodeId).toBe("node_work")
    expect(clearDuplicateCanvasNodeIds(repaired)).toBe(repaired)
  })

  it("keeps the source identity on only one heading when a source heading is split", () => {
    const editor = new Editor({
      extensions: [StarterKit, BlockStyle],
      content: {
        type: "doc",
        content: [{
          type: "heading",
          attrs: { level: 3, canvasNodeId: "node_work", sourceBlockId: "block_work" },
          content: [{ type: "text", text: "公司名称职位名称" }],
        }],
      },
    })

    editor.commands.setTextSelection(5)
    editor.commands.splitBlock()

    expect(sourceNodes(editor)).toEqual([
      { text: "公司名称", canvasNodeId: "node_work", sourceBlockId: "block_work" },
      { text: "职位名称", canvasNodeId: null, sourceBlockId: null },
    ])
    editor.commands.undo()
    expect(sourceNodes(editor)).toEqual([
      { text: "公司名称职位名称", canvasNodeId: "node_work", sourceBlockId: "block_work" },
    ])
    editor.destroy()
  })

  it("removes a copied heading's source identity inside a column", () => {
    const editor = new Editor({
      extensions: [StarterKit, BlockStyle, Columns, Column],
      content: {
        type: "doc",
        content: [{
          type: "columns",
          attrs: { count: 2, gap: "default", widths: [50, 50] },
          content: [
            { type: "column", content: [{
              type: "heading",
              attrs: { level: 3, canvasNodeId: "node_work", sourceBlockId: "block_work" },
              content: [{ type: "text", text: "公司名称" }],
            }] },
            { type: "column", content: [{ type: "paragraph" }] },
          ],
        }],
      },
    })

    let secondColumnPos = -1
    let columnIndex = 0
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== "column") return
      columnIndex += 1
      if (columnIndex === 2) secondColumnPos = pos
    })

    editor.commands.insertContentAt(secondColumnPos + 1, {
      type: "heading",
      attrs: { level: 3, canvasNodeId: "node_work", sourceBlockId: "block_work" },
      content: [{ type: "text", text: "职位名称" }],
    })

    expect(sourceNodes(editor)).toEqual([
      { text: "公司名称", canvasNodeId: "node_work", sourceBlockId: "block_work" },
      { text: "职位名称", canvasNodeId: null, sourceBlockId: null },
    ])
    expect(editor.getJSON().content?.[0].type).toBe("columns")
    expect(editor.getJSON().content?.[0].content).toHaveLength(2)
    editor.destroy()
  })

  it("keeps the original source identity when a copy is inserted before it", () => {
    const editor = new Editor({
      extensions: [StarterKit, BlockStyle],
      content: {
        type: "doc",
        content: [{
          type: "heading",
          attrs: { level: 3, canvasNodeId: "node_work", sourceBlockId: "block_work" },
          content: [{ type: "text", text: "原始标题" }],
        }],
      },
    })

    editor.commands.insertContentAt(0, {
      type: "heading",
      attrs: { level: 3, canvasNodeId: "node_work", sourceBlockId: "block_work" },
      content: [{ type: "text", text: "复制标题" }],
    })

    expect(sourceNodes(editor)).toEqual([
      { text: "复制标题", canvasNodeId: null, sourceBlockId: null },
      { text: "原始标题", canvasNodeId: "node_work", sourceBlockId: "block_work" },
    ])
    editor.destroy()
  })
})
