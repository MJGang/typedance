import { afterEach, describe, expect, it } from "vitest"
import { Editor, type JSONContent } from "@tiptap/core"
import StarterKit from "@tiptap/starter-kit"
import type { EditorTransaction } from "@typedance/contracts"
import { applyEditorTransaction } from "./editorTransaction"
import { DocumentLayout, sameTemplateStyle } from "./documentLayout"
import { defaultClassicA4Style } from "../templates/data"
import { ReferenceTracker, referenceTrackerKey } from "./references/referenceTracker"

const editors: Editor[] = []
function setup() {
  const editor = new Editor({ extensions: [StarterKit, DocumentLayout, ReferenceTracker], content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "保留的经历" }] }] } })
  editors.push(editor)
  return editor
}
type TestDocument = JSONContent & { attrs: { pageMargins: { top: number; bottom: number; left: number; right: number } }; content: Array<JSONContent & { content: JSONContent[] }> }
function transaction(editor: Editor, mutate: (doc: TestDocument) => void): EditorTransaction {
  const before = editor.getJSON()
  const after = structuredClone(before)
  mutate(after as TestDocument)
  return { id: "transaction", document_id: "doc", editor_session_id: "session", content_revision: referenceTrackerKey.getState(editor.state)?.revision ?? 0,
    before_doc_json: before, doc_json: after, catalog_revision: "current", summary: "修改", effects: [] }
}
afterEach(() => { editors.splice(0).forEach((editor) => editor.destroy()) })

describe("document editing transaction", () => {
  it("compares actual template values across differently ordered JSON objects", () => {
    // 逐层重排，保留所有嵌套样式字段。
    const reverse = (value: unknown): unknown => value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverse(child)])) : value
    expect(sameTemplateStyle(defaultClassicA4Style, reverse(defaultClassicA4Style) as typeof defaultClassicA4Style)).toBe(true)
    expect(sameTemplateStyle(defaultClassicA4Style, { ...defaultClassicA4Style, theme: { accentColor: "#112233" } })).toBe(false)
  })
  it("preserves earlier undo history and makes a multi-part edit one undo step", () => {
    const editor = setup()
    editor.commands.insertContentAt(1, "用户输入")
    const before = editor.getJSON()
    const change = transaction(editor, (doc) => {
      doc.content[0].content[0].marks = [{ type: "bold" }]
      doc.attrs.pageMargins = { top: 40, bottom: 40, left: 36, right: 36 }
    })
    applyEditorTransaction(editor, "doc", "session", change)
    expect(editor.getJSON()).toEqual(change.doc_json)
    expect(editor.commands.undo()).toBe(true)
    expect(editor.getJSON()).toEqual(before)
    expect(editor.commands.undo()).toBe(true)
    expect(editor.getText()).toBe("保留的经历")
  })

  it("rejects stale revisions, switched sessions and changed text before writing", () => {
    const editor = setup()
    const change = transaction(editor, (doc) => { doc.content[0].content[0].text = "AI修改" })
    expect(() => applyEditorTransaction(editor, "other", "session", change)).toThrow("会话已变化")
    expect(() => applyEditorTransaction(editor, "doc", "other", change)).toThrow("会话已变化")
    editor.commands.insertContentAt(1, "后续输入")
    const current = editor.getJSON()
    expect(() => applyEditorTransaction(editor, "doc", "session", change)).toThrow("会话已变化")
    expect(editor.getJSON()).toEqual(current)
  })

  it("validates the full resulting schema before applying any part of a batch", () => {
    const editor = setup()
    const before = editor.getJSON()
    const change = transaction(editor, (doc) => { doc.content[0] = { type: "unknownNode", content: [] }; doc.attrs.pageMargins.left = 100 })
    expect(() => applyEditorTransaction(editor, "doc", "session", change)).toThrow()
    expect(editor.getJSON()).toEqual(before)
  })

  it("keeps document layout settings in JSON across reopening", () => {
    const editor = setup()
    const change = transaction(editor, (doc) => { doc.attrs.pageMargins = { top: 40, bottom: 40, left: 24, right: 24 } })
    applyEditorTransaction(editor, "doc", "session", change)
    const reopened = new Editor({ extensions: [StarterKit, DocumentLayout, ReferenceTracker], content: editor.getJSON() })
    editors.push(reopened)
    expect(reopened.getJSON().attrs?.pageMargins).toEqual({ top: 40, bottom: 40, left: 24, right: 24 })
  })

  it("applies heading conversion with marks and reverts exactly one conversion at a time", () => {
    const editor = setup()
    const before = editor.getJSON()
    const heading = transaction(editor, (doc) => { doc.content[0].type = "heading"; doc.content[0].attrs = { level: 2 }; doc.content[0].content[0].marks = [{ type: "bold" }] })
    applyEditorTransaction(editor, "doc", "session", heading)
    const appliedHeading = editor.getJSON()
    const paragraph = transaction(editor, (doc) => { doc.content[0].type = "paragraph"; doc.content[0].attrs = {} })
    applyEditorTransaction(editor, "doc", "session", paragraph)
    editor.commands.undo()
    expect(editor.getJSON()).toEqual(appliedHeading)
    editor.commands.undo()
    expect(editor.getJSON()).toEqual(before)
  })
})
