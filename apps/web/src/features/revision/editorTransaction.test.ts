import { afterEach, describe, expect, it, vi } from "vitest"
import { Editor, type JSONContent } from "@tiptap/core"
import StarterKit from "@tiptap/starter-kit"
import { Column, Columns } from "@typedance/tiptap-layout"
import type { EditorReference, EditorTransaction } from "@typedance/contracts"
import { applyEditorTransaction } from "./editorTransaction"
import { DocumentLayout, sameTemplateStyle } from "./documentLayout"
import { defaultClassicA4Style } from "../templates/data"
import { ReferenceTracker, referenceMatches, referenceTrackerKey } from "./references/referenceTracker"
import { BlockStyle } from "../workspace/components/ResumeRichTextEditor"
import { prepareWithSidecar } from "@/test/sidecarEditor"

const editors: Editor[] = []
function setup(content: JSONContent = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "保留的经历" }] }] }) {
  const editor = new Editor({ extensions: [StarterKit, BlockStyle, Columns, Column, DocumentLayout, ReferenceTracker], content })
  editors.push(editor)
  return editor
}

function track(editor: Editor, text: string, occurrence?: number) {
  const matches: number[] = []
  editor.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return
    for (let offset = node.textContent.indexOf(text); offset >= 0; offset = node.textContent.indexOf(text, offset + text.length)) matches.push(pos + 1 + offset)
  })
  const from = matches[occurrence ?? matches.length - 1] ?? -1
  expect(from).toBeGreaterThanOrEqual(0)
  const to = from + text.length
  const reference: EditorReference = { id: "ref", ordinal: 1, document_id: "doc", text, label: "引用", comment: "", source: {
    kind: "canvas", editor_session_id: "session", content_revision: 0, from, to, slice_content: editor.state.doc.slice(from, to).content.toJSON() ?? [],
  } }
  editor.view.dispatch(editor.state.tr.setMeta(referenceTrackerKey, { type: "add", reference }))
  return reference
}

function expectTracked(editor: Editor, text: string) {
  const reference = referenceTrackerKey.getState(editor.state)!.references[0]
  expect(reference.changed).toBe(false)
  expect(referenceMatches(editor.state.doc, reference.source, text)).toBe(true)
  return reference
}

function paragraphs(...texts: string[]): JSONContent {
  return { type: "doc", content: texts.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })) }
}
type TestDocument = JSONContent & { attrs: { pageMargins: { top: number; bottom: number; left: number; right: number } }; content: Array<JSONContent & { content: JSONContent[] }> }
function transaction(editor: Editor, mutate: (doc: TestDocument) => void): EditorTransaction {
  const before = editor.getJSON()
  const after = structuredClone(before)
  mutate(after as TestDocument)
  return { id: "transaction", document_id: "doc", editor_session_id: "session", content_revision: referenceTrackerKey.getState(editor.state)?.revision ?? 0,
    before_doc_json: before, doc_json: after, catalog_revision: "current", summary: "修改", effects: [], node_origins: [], text_origins: [] }
}
afterEach(() => { editors.splice(0).forEach((editor) => editor.destroy()) })

describe("document editing transaction", () => {
  it.each([0, 1])("tracks exact original text when deleting one of two identical inline occurrences; quote=%s", (occurrence) => {
    const editor = setup(paragraphs("引用😀与引用😀"))
    const reference = track(editor, "引用😀", occurrence)
    const prepared = prepareWithSidecar(editor.getJSON(), [{ capability: "text.replace", parameters: { path: [0], text: "引用😀", occurrence: 0, replacement: "" } }])
    applyEditorTransaction(editor, "doc", "session", { ...transaction(editor, () => {}), ...prepared })
    if (occurrence === 0) expect(referenceTrackerKey.getState(editor.state)!.references[0].changed).toBe(true)
    else expect(expectTracked(editor, reference.text).source.from).toBe(2)
    editor.commands.undo()
    expectTracked(editor, reference.text)
    editor.commands.redo()
    expect(referenceTrackerKey.getState(editor.state)!.references[0].changed).toBe(occurrence === 0)
  })

  it("follows original Unicode fragments through formatting, normalized text nodes and column layout", () => {
    const editor = setup(paragraphs("甲公司 | Agent😀负责人"))
    const reference = track(editor, "Agent😀负责人")
    const prepared = prepareWithSidecar(editor.getJSON(), [
      { capability: "text.format", parameters: { path: [0], text: "甲", mark: "bold", enabled: false } },
      { capability: "columns.layout", parameters: { widths: [50, 50], alignments: ["left", "right"], rows: [{ paths: [[0]], cells: [["甲公司"], ["Agent😀负责人"]] }] } },
    ])
    applyEditorTransaction(editor, "doc", "session", { ...transaction(editor, () => {}), ...prepared })
    const current = expectTracked(editor, reference.text)
    expect(editor.state.doc.resolve(current.source.from).parent.attrs.textAlign).toBe("right")
    expect(current.source.kind === "canvas" && current.source.canvas_node_id).toBeTruthy()
    editor.commands.undo()
    expectTracked(editor, reference.text)
    editor.commands.redo()
    expectTracked(editor, reference.text)
  })

  it("invalidates a quote whose marks changed even when its original characters survive", () => {
    const editor = setup(paragraphs("引用😀"))
    track(editor, "引用😀")
    const prepared = prepareWithSidecar(editor.getJSON(), [{ capability: "text.format", parameters: { path: [0], text: "引用😀", mark: "bold" } }])
    applyEditorTransaction(editor, "doc", "session", { ...transaction(editor, () => {}), ...prepared })
    expect(referenceTrackerKey.getState(editor.state)!.references[0].changed).toBe(true)
    editor.commands.undo()
    expectTracked(editor, "引用😀")
  })

  it("rejects inaccurate original-text provenance without applying any change", () => {
    const editor = setup(paragraphs("原段落"))
    const before = editor.getJSON()
    const change = transaction(editor, (doc) => { doc.content[0].content[0].text = "新段落" })
    change.text_origins = [{ before_path: [0], spans: [{ before_from: 0, before_to: 1, after_path: [0], after_from: 0 }] }]
    expect(() => applyEditorTransaction(editor, "doc", "session", change)).toThrow("原文来源")
    expect(editor.getJSON()).toEqual(before)
  })

  it.each([0, 1])("uses backend provenance when deleting the first of two identical paragraphs; quote=%s", (occurrence) => {
    const editor = setup(paragraphs("相同引用", "相同引用"))
    const reference = track(editor, "相同引用", occurrence)
    const prepared = prepareWithSidecar(editor.getJSON(), [{ capability: "blocks.delete", parameters: { paths: [[0]] } }])
    applyEditorTransaction(editor, "doc", "session", { ...transaction(editor, () => {}), doc_json: prepared.doc_json, node_origins: prepared.node_origins, text_origins: prepared.text_origins })
    if (occurrence === 0) expect(referenceTrackerKey.getState(editor.state)!.references[0].changed).toBe(true)
    else expect(expectTracked(editor, reference.text).source.from).toBe(1)
    editor.commands.undo()
    expectTracked(editor, reference.text)
  })

  it.each([
    ["columns.wrap", false], ["columns.wrap", true], ["list.convert", false], ["list.convert", true],
  ] as const)("preserves a null-ID paragraph reference through backend %s, repeated text=%s", (capability, repeated) => {
    const text = repeated ? "重复引用" : "第二段引用"
    const editor = setup(paragraphs(repeated ? text : "第一段", text))
    const reference = track(editor, text)
    const prepared = prepareWithSidecar(editor.getJSON(), [{ capability, parameters: {
      paths: [[0], [1]], ...(capability === "columns.wrap" ? { count: 2 } : { kind: "bulletList", style: "disc" }),
    } }])
    const change = { ...transaction(editor, () => {}), doc_json: prepared.doc_json, node_origins: prepared.node_origins, text_origins: prepared.text_origins }
    applyEditorTransaction(editor, "doc", "session", change)
    const current = expectTracked(editor, reference.text)
    expect(current.source.from).toBeGreaterThan(3)
    editor.commands.undo()
    expectTracked(editor, reference.text)
    editor.commands.redo()
    expectTracked(editor, reference.text)
  })

  it("rejects an invalid origin path before changing the document", () => {
    const editor = setup(paragraphs("原段落", "其他段落"))
    const before = editor.getJSON()
    const change = transaction(editor, (doc) => { doc.content[1].content[0].text = "新的其他段落" })
    change.node_origins = [{ before_path: [0], after_path: [20] }]
    expect(() => applyEditorTransaction(editor, "doc", "session", change)).toThrow("节点路径")
    expect(editor.getJSON()).toEqual(before)
  })

  it("does not dispatch or create undo history for an unchanged document", () => {
    const editor = setup()
    editor.commands.insertContentAt(1, "用户输入")
    const before = editor.getJSON()
    const dispatch = vi.spyOn(editor.view, "dispatch")
    const revision = referenceTrackerKey.getState(editor.state)!.revision
    expect(applyEditorTransaction(editor, "doc", "session", transaction(editor, () => {}))).toBe(false)
    expect(editor.getJSON()).toEqual(before)
    expect(dispatch).not.toHaveBeenCalled()
    expect(referenceTrackerKey.getState(editor.state)!.revision).toBe(revision)
    expect(editor.commands.undo()).toBe(true)
    expect(editor.getText()).toBe("保留的经历")
  })

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

  it("restores the original reference range and validity on native undo, and invalidates it again on redo", () => {
    const editor = setup(paragraphs("前文", "原文引用内容", "后文"))
    const original = track(editor, "原文引用内容")
    const change = transaction(editor, (doc) => { doc.content[1].content[0].text = "更短" })
    applyEditorTransaction(editor, "doc", "session", change)
    expect(referenceTrackerKey.getState(editor.state)!.references[0].changed).toBe(true)
    expect(editor.commands.undo()).toBe(true)
    const restored = expectTracked(editor, original.text)
    expect(restored.source).toMatchObject({ from: original.source.kind === "canvas" ? original.source.from : 0, to: original.source.kind === "canvas" ? original.source.to : 0 })
    expect(editor.commands.redo()).toBe(true)
    expect(referenceTrackerKey.getState(editor.state)!.references[0].changed).toBe(true)
    expect(editor.commands.undo()).toBe(true)
    expectTracked(editor, original.text)
  })

  it("does not resurrect removed references and keeps newer marker numbers when undo restores an anchor", () => {
    const editor = setup(paragraphs("原文引用内容"))
    track(editor, "原文引用内容")
    const change = transaction(editor, (doc) => { doc.content[0].content[0].text = "AI修改" })
    applyEditorTransaction(editor, "doc", "session", change)
    editor.view.dispatch(editor.state.tr.setMeta(referenceTrackerKey, { type: "renumber", ordinals: [{ id: "ref", ordinal: 3 }] }))
    editor.commands.undo()
    expect(expectTracked(editor, "原文引用内容").ordinal).toBe(3)
    editor.commands.redo()
    editor.view.dispatch(editor.state.tr.setMeta(referenceTrackerKey, { type: "remove", id: "ref" }))
    editor.commands.undo()
    expect(referenceTrackerKey.getState(editor.state)!.references).toEqual([])
  })

  it("maps the saved reference through an unrecorded preceding edit before undo and redo", () => {
    const editor = setup(paragraphs("前文", "原文引用内容"))
    const original = track(editor, "原文引用内容")
    applyEditorTransaction(editor, "doc", "session", transaction(editor, (doc) => { doc.content[1].content[0].text = "更短" }))
    editor.view.dispatch(editor.state.tr.insertText("新增", 1).setMeta("addToHistory", false))
    editor.commands.undo()
    const restored = expectTracked(editor, original.text)
    if (original.source.kind !== "canvas") throw new Error("expected canvas reference")
    expect(restored.source.from).toBe(original.source.from + 2)
    expect(restored.source.to).toBe(original.source.to + 2)
    editor.commands.redo()
    expect(referenceTrackerKey.getState(editor.state)!.references[0].changed).toBe(true)
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

  it("preserves references and cursor in the untouched paragraph between disjoint formatting edits", () => {
    const editor = setup(paragraphs("第一段格式", "中间引用😀保留", "第三段格式"))
    const reference = track(editor, "中间引用😀保留")
    editor.commands.setTextSelection(reference.source.kind === "canvas" ? reference.source.from + 2 : 1)
    const cursor = editor.state.selection.from
    const change = transaction(editor, (doc) => {
      doc.content[0].content[0].marks = [{ type: "bold" }]
      doc.content[2].content[0].marks = [{ type: "italic" }]
    })
    applyEditorTransaction(editor, "doc", "session", change)
    expectTracked(editor, reference.text)
    expect(editor.state.selection.from).toBe(cursor)
    editor.commands.undo()
    expectTracked(editor, reference.text)
  })

  it("uses attribute steps without moving paragraph references or cursor", () => {
    const editor = setup(paragraphs("段内引用😀保持位置"))
    const reference = track(editor, "引用😀")
    editor.commands.setTextSelection(4)
    const change = transaction(editor, (doc) => { doc.content[0].attrs!.textAlign = "right" })
    applyEditorTransaction(editor, "doc", "session", change)
    expect(editor.getAttributes("paragraph").textAlign).toBe("right")
    expectTracked(editor, reference.text)
    expect(editor.state.selection.from).toBe(4)
  })

  it("keeps unmarked ranges stable when formatting splits a text node", () => {
    const editor = setup(paragraphs("前部需要加粗，中间引用😀，后部需要加粗"))
    const reference = track(editor, "中间引用😀")
    const change = transaction(editor, (doc) => { doc.content[0].content = [
      { type: "text", text: "前部需要加粗", marks: [{ type: "bold" }] },
      { type: "text", text: "，中间引用😀，" },
      { type: "text", text: "后部需要加粗", marks: [{ type: "bold" }] },
    ] })
    applyEditorTransaction(editor, "doc", "session", change)
    expectTracked(editor, reference.text)
  })

  it("maps a Unicode reference through separated text edits in the same paragraph", () => {
    const editor = setup(paragraphs("旧开头，中间引用😀，旧结尾"))
    const reference = track(editor, "中间引用😀")
    const change = transaction(editor, (doc) => { doc.content[0].content[0].text = "新的开头，中间引用😀，全新的结尾" })
    applyEditorTransaction(editor, "doc", "session", change)
    expectTracked(editor, reference.text)
  })

  it("preserves untouched references between separate structural deletions", () => {
    const editor = setup(paragraphs("保留第一段", "删除第二段", "中间引用保留", "删除第四段", "保留第五段"))
    const reference = track(editor, "中间引用保留")
    const change = transaction(editor, (doc) => { doc.content.splice(3, 1); doc.content.splice(1, 1) })
    applyEditorTransaction(editor, "doc", "session", change)
    expectTracked(editor, reference.text)
    expect(editor.getJSON().content).toHaveLength(3)
    editor.commands.undo()
    expectTracked(editor, reference.text)
    expect(editor.getJSON().content).toHaveLength(5)
  })

  it("safely replaces a leaf block with a content-bearing block", () => {
    const editor = setup({ type: "doc", content: [{ type: "horizontalRule" }] })
    const change = transaction(editor, (doc) => { doc.content[0] = { type: "paragraph", content: [{ type: "text", text: "替换后的段落" }] } })
    applyEditorTransaction(editor, "doc", "session", change)
    expect(editor.getText()).toBe("替换后的段落")
    editor.commands.undo()
    expect(editor.getJSON().content?.[0].type).toBe("horizontalRule")
  })

  it.each([2, 4, 6])("reorders %s columns with formatting without invalid intermediate counts or losing untouched references", (count) => {
    const columns = Array.from({ length: count }, (_, index) => ({ type: "column", content: [{ type: "paragraph", attrs: { canvasNodeId: `node_${index}` }, content: [{ type: "text", text: `第${index}栏原文` }] }] }))
    const editor = setup({ type: "doc", content: [{ type: "columns", attrs: { count }, content: columns }, { type: "paragraph" }] })
    const reference = track(editor, "第0栏原文")
    const change = transaction(editor, (doc) => {
      const row = doc.content[0].content
      row.unshift(row.pop()!)
      row[0].content![0].content![0].marks = [{ type: "bold" }]
    })
    applyEditorTransaction(editor, "doc", "session", change)
    expect(editor.state.doc.child(0).childCount).toBe(count)
    expect(editor.state.doc.child(0).child(0).textContent).toBe(`第${count - 1}栏原文`)
    expectTracked(editor, reference.text)
    editor.commands.undo()
    expect(editor.state.doc.child(0).child(0).textContent).toBe("第0栏原文")
    expectTracked(editor, reference.text)
  })

  it.each([2, 4, 6])("keeps a reference in the moved last column valid through %s-column reorder, undo and redo", (count) => {
    const columns = Array.from({ length: count }, (_, index) => ({ type: "column", content: [{ type: "paragraph", content: [{ type: "text", text: `第${index}栏引用😀` }] }] }))
    const editor = setup({ type: "doc", content: [{ type: "columns", attrs: { count }, content: columns }] })
    const reference = track(editor, `第${count - 1}栏引用😀`)
    const change = transaction(editor, (doc) => { const row = doc.content[0].content; row.unshift(row.pop()!) })
    applyEditorTransaction(editor, "doc", "session", change)
    const moved = expectTracked(editor, reference.text)
    expect(moved.source.from).toBe(3)
    editor.commands.undo()
    expectTracked(editor, reference.text)
    editor.commands.redo()
    expect(expectTracked(editor, reference.text).source.from).toBe(3)
  })

  it("follows the moved node identity when another column contains identical quote text", () => {
    const columns = ["first", "second"].map((id) => ({ type: "column", content: [{ type: "paragraph", attrs: { canvasNodeId: id }, content: [{ type: "text", text: "相同引用" }] }] }))
    const editor = setup({ type: "doc", content: [{ type: "columns", attrs: { count: 2 }, content: columns }] })
    const reference = track(editor, "相同引用")
    applyEditorTransaction(editor, "doc", "session", transaction(editor, (doc) => { doc.content[0].content.reverse() }))
    const moved = expectTracked(editor, reference.text)
    expect(editor.state.doc.resolve(moved.source.from).parent.attrs.canvasNodeId).toBe("second")
    expect(moved.source.from).toBe(3)
  })

  it("does not rebind a deleted quote to another paragraph with identical text", () => {
    const editor = setup({ type: "doc", content: ["first", "second"].map((id) => ({ type: "paragraph", attrs: { canvasNodeId: id }, content: [{ type: "text", text: "相同引用" }] })) })
    track(editor, "相同引用")
    applyEditorTransaction(editor, "doc", "session", transaction(editor, (doc) => { doc.content.pop() }))
    expect(referenceTrackerKey.getState(editor.state)!.references[0].changed).toBe(true)
  })

  it("does not treat a node object reused at two positions as a unique identity", () => {
    const editor = setup(paragraphs("相同引用"))
    editor.view.dispatch(editor.state.tr.insert(editor.state.doc.content.size, editor.state.doc.firstChild!))
    expect(editor.state.doc.firstChild).toBe(editor.state.doc.lastChild)
    track(editor, "相同引用")
    applyEditorTransaction(editor, "doc", "session", transaction(editor, (doc) => { doc.content.pop() }))
    expect(referenceTrackerKey.getState(editor.state)!.references[0].changed).toBe(true)
  })
})
