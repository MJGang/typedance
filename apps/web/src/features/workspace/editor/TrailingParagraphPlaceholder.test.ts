import { Editor, type JSONContent } from "@tiptap/core"
import { Column, Columns, Timeline, TimelineItem } from "@typedance/tiptap-layout"
import { afterEach, describe, expect, it } from "vitest"
import { MarkdownStarterKit } from "./MarkdownEditing"
import { TrailingParagraphPlaceholder } from "./TrailingParagraphPlaceholder"

const editors: Editor[] = []
const paragraph = (text = ""): JSONContent => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] })
const list: JSONContent = { type: "bulletList", content: [{ type: "listItem", content: [paragraph("保留完整的最后一项")] }] }
const selector = "[data-rm-pagination-ignore]"

function open(content: JSONContent[]) {
  const editor = new Editor({
    extensions: [MarkdownStarterKit, Columns, Column, Timeline, TimelineItem, TrailingParagraphPlaceholder],
    content: { type: "doc", content },
    editorProps: { handleScrollToSelection: () => true },
  })
  editors.push(editor)
  editor.view.dispatch(editor.state.tr)
  return editor
}

afterEach(() => { editors.splice(0).forEach((editor) => editor.destroy()) })

describe("末尾段落输入占位", () => {
  it.each<JSONContent>([
    list,
    { ...list, type: "orderedList" },
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "末尾标题" }] },
    { type: "blockquote", content: [paragraph("引用")] },
    { type: "codeBlock", content: [{ type: "text", text: "code" }] },
    { type: "horizontalRule" },
    { type: "columns", attrs: { count: 2 }, content: [{ type: "column", content: [paragraph("左栏")] }, { type: "column", content: [paragraph("右栏")] }] },
    { type: "timeline", content: [{ type: "timelineItem", content: [paragraph("工作经历")] }] },
  ])("为 $type 之后自动补齐的段落提供不参与分页的输入位置", (block) => {
    const editor = open([block])
    const placeholder = editor.view.dom.querySelector<HTMLElement>(selector)
    expect(placeholder?.tagName).toBe("P")
    expect(placeholder?.style.position).toBe("absolute")
    expect(editor.state.doc.lastChild?.type.name).toBe("paragraph")
    expect(editor.state.doc.lastChild?.content.size).toBe(0)
    expect(editor.getJSON().content?.[0].type).toBe(block.type)
    expect(JSON.stringify(editor.getJSON())).not.toContain("data-rm-pagination-ignore")
    expect(editor.getHTML()).not.toContain("data-rm-pagination-ignore")
  })

  it("输入正文恢复正常排版，撤销后恢复占位且不丢失列表内容", () => {
    const editor = open([list])
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    editor.commands.insertContent("继续写正文")
    expect(editor.view.dom.querySelector(selector)).toBeNull()
    expect(editor.state.doc.lastChild?.textContent).toBe("继续写正文")
    expect(editor.state.doc.firstChild?.textContent).toBe("保留完整的最后一项")
    editor.commands.undo()
    expect(editor.view.dom.querySelector(selector)).not.toBeNull()
    expect(editor.state.doc.firstChild?.textContent).toBe("保留完整的最后一项")
  })

  it("删除占位段落后补回的段落仍不参与分页", () => {
    const editor = open([list])
    const before = editor.getJSON()
    const doc = editor.state.doc
    editor.view.dispatch(editor.state.tr.delete(doc.content.size - doc.lastChild!.nodeSize, doc.content.size))
    expect(editor.getJSON()).toEqual(before)
    expect(editor.view.dom.querySelector(selector)).not.toBeNull()
  })

  it.each([
    [paragraph()],
    [paragraph("普通正文"), paragraph()],
    [list, paragraph(), paragraph()],
    [list, paragraph(" ")],
    [list, paragraph("继续写正文")],
  ])("保留普通段落、主动留空行和已有正文的排版", (...content) => {
    const editor = open(content)
    expect(editor.view.dom.querySelector(selector)).toBeNull()
    expect(editor.state.doc.childCount).toBe(content.length)
  })
})
