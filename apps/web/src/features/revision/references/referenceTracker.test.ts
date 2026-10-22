import { describe, expect, it } from "vitest"
import { Schema } from "@tiptap/pm/model"
import { EditorState, Plugin } from "@tiptap/pm/state"
import type { EditorReference } from "@typedance/contracts"
import { referenceMatches, referenceTrackerKey, updateReferenceState } from "./referenceTracker"

const schema = new Schema({ nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*" }, text: {} } })
function setup() {
  const doc = schema.node("doc", null, [schema.node("paragraph", null, schema.text("甲乙")), schema.node("paragraph", null, schema.text("丙丁"))])
  let state = EditorState.create({ doc, plugins: [new Plugin({ key: referenceTrackerKey, state: { init: () => ({ revision: 0, references: [] }), apply: updateReferenceState } })] })
  const reference: EditorReference = { id: "ref", ordinal: 1, document_id: "doc", label: "正文", text: "丙丁", comment: "精简",
    source: { kind: "canvas", editor_session_id: "session", content_revision: 0, from: 5, to: 7, slice_content: doc.slice(5, 7).content.toJSON() } }
  state = state.apply(state.tr.setMeta(referenceTrackerKey, { type: "add", reference }))
  return state
}

describe("reference anchors", () => {
  it("moves the anchor after preceding edits without changing the reference text or the document", () => {
    let state = setup()
    expect(state.doc.textContent).toBe("甲乙丙丁")
    state = state.apply(state.tr.insertText("新增", 2))
    const reference = referenceTrackerKey.getState(state)?.references[0]
    expect(reference?.source).toMatchObject({ from: 7, to: 9, content_revision: 1 })
    expect(reference?.changed).toBe(false)
    expect(referenceMatches(state.doc, reference!.source, "丙丁")).toBe(true)
  })
  it("marks a modified or deleted selection stale instead of binding to another matching sentence", () => {
    let state = setup()
    state = state.apply(state.tr.insertText("新", 5, 6))
    expect(referenceTrackerKey.getState(state)?.references[0]?.changed).toBe(true)
    state = state.apply(state.tr.delete(5, 7))
    expect(referenceTrackerKey.getState(state)?.references[0]?.changed).toBe(true)
  })
  it("removes a reference without deleting any document content", () => {
    const state = setup()
    const next = state.apply(state.tr.setMeta(referenceTrackerKey, { type: "remove", id: "ref" }))
    expect(next.doc.eq(state.doc)).toBe(true)
    expect(referenceTrackerKey.getState(next)?.references).toEqual([])
  })
  it("binds a newly added quote to the current revision after editor normalization", () => {
    let state = setup()
    const tracked = referenceTrackerKey.getState(state)!.references[0]!
    state = state.apply(state.tr.setNodeMarkup(0, undefined, {}))
    state = state.apply(state.tr.setMeta(referenceTrackerKey, { type: "add", reference: {
      id: tracked.id, ordinal: tracked.ordinal, document_id: "doc", label: "正文", text: tracked.text, comment: "改写", source: tracked.source,
    } }))
    expect(referenceTrackerKey.getState(state)?.references[0]?.source.content_revision).toBe(1)
    expect(referenceTrackerKey.getState(state)?.references[0]?.changed).toBe(false)
  })
})
