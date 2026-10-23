import { Extension } from "@tiptap/core"
import type { Node as ProseMirrorNode, Schema } from "@tiptap/pm/model"
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state"
import { Step, StepResult, type Mappable } from "@tiptap/pm/transform"
import { Decoration, DecorationSet } from "@tiptap/pm/view"
import type { EditorReference } from "@typedance/contracts"
import type { CanvasReferenceSource, TrackedCanvasReference } from "./EditorReferences"

export type TrackedReference = TrackedCanvasReference & { text: string; ordinal: number }
type ReferenceState = { revision: number; references: TrackedReference[] }
type ReferenceAction = { type: "add"; reference: EditorReference } | { type: "remove"; id: string } | { type: "renumber"; ordinals: Pick<EditorReference, "id" | "ordinal">[] }
export const referenceTrackerKey = new PluginKey<ReferenceState>("typedance-editor-references")

type ReferenceHistory = Pick<TrackedReference, "id" | "source" | "changed">

/** 引用是会话 UI 状态，通过可反转的原生 step 跟随文档撤销/重做，不维护另一套撤销栈。 */
class ReferenceHistoryStep extends Step {
  constructor(readonly before: ReferenceHistory[], readonly after: ReferenceHistory[]) { super() }
  apply(doc: ProseMirrorNode) { return StepResult.ok(doc) }
  invert() { return new ReferenceHistoryStep(this.after, this.before) }
  map(mapping: Mappable) {
    const mapped = (references: ReferenceHistory[]) => references.map((reference) => ({ ...reference, source: {
      ...reference.source, from: mapping.map(reference.source.from, 1), to: mapping.map(reference.source.to, -1),
    } }))
    return new ReferenceHistoryStep(mapped(this.before), mapped(this.after))
  }
  toJSON() { return { stepType: "typedanceReferenceHistory", before: this.before, after: this.after } }
  static fromJSON(_schema: Schema, json: { before: ReferenceHistory[]; after: ReferenceHistory[] }) {
    if (!Array.isArray(json.before) || !Array.isArray(json.after)) throw new RangeError("Invalid reference history")
    return new ReferenceHistoryStep(json.before, json.after)
  }
}
Step.jsonID("typedanceReferenceHistory", ReferenceHistoryStep)

export function preserveReferenceHistory(transaction: Transaction, state: ReferenceState | undefined): void {
  if (!state?.references.length) return
  const snapshot = (references: TrackedReference[]) => references.map(({ id, source, changed }) => ({ id, source: structuredClone(source), changed }))
  transaction.step(new ReferenceHistoryStep(snapshot(state.references), snapshot(updateReferenceState(transaction, state).references)))
}

export function referenceMatches(doc: ProseMirrorNode, source: CanvasReferenceSource, text: string): boolean {
  if (source.from < 0 || source.to > doc.content.size || source.to <= source.from) return false
  return doc.textBetween(source.from, source.to, "\n", "\n") === text
    && JSON.stringify(doc.slice(source.from, source.to).content.toJSON() ?? []) === JSON.stringify(source.slice_content)
}

/** 删除后重新插入的未变节点可凭对象身份/稳定 ID 重新定位，禁止按相同文字猜测锚点。 */
function relocatedReference(transaction: Transaction, reference: TrackedReference): CanvasReferenceSource | undefined {
  if (!referenceMatches(transaction.before, reference.source, reference.text)) return
  const { from, to } = reference.source
  const resolved = transaction.before.resolve(from)
  const anchors: Array<{ node: ProseMirrorNode; position: number }> = []
  for (let depth = resolved.depth; depth > 0; depth--) {
    if (to <= resolved.end(depth)) anchors.push({ node: resolved.node(depth), position: resolved.before(depth) })
  }
  const selected = transaction.before.nodeAt(from)
  if (selected && !selected.isText && to <= from + selected.nodeSize) anchors.unshift({ node: selected, position: from })
  for (const anchor of anchors) {
    const id: unknown = anchor.node.attrs.canvasNodeId
    const sameIdentity = (node: ProseMirrorNode) => node === anchor.node || (typeof id === "string" && Boolean(id) && node.attrs.canvasNodeId === id)
    let originalCount = 0
    transaction.before.descendants((node) => { if (sameIdentity(node)) { originalCount++; return false } })
    if (originalCount !== 1) continue
    const matches: Array<{ node: ProseMirrorNode; position: number }> = []
    transaction.doc.descendants((node, position) => {
      if (sameIdentity(node)) {
        matches.push({ node, position })
        return false
      }
    })
    if (matches.length !== 1 || !matches[0].node.content.eq(anchor.node.content)) continue
    const delta = matches[0].position - anchor.position
    const source = { ...reference.source, from: from + delta, to: to + delta }
    if (referenceMatches(transaction.doc, source, reference.text)) return source
  }
}

export function updateReferenceState(transaction: Transaction, previous: ReferenceState): ReferenceState {
  const revision = previous.revision + (transaction.docChanged ? 1 : 0)
  let references = transaction.docChanged ? previous.references.map((reference) => {
    const from = transaction.mapping.mapResult(reference.source.from, 1)
    const to = transaction.mapping.mapResult(reference.source.to, -1)
    let source = { ...reference.source, from: from.pos, to: to.pos, content_revision: revision }
    if (!reference.changed && (from.deleted || to.deleted || !referenceMatches(transaction.doc, source, reference.text))) {
      const relocated = relocatedReference(transaction, reference)
      if (relocated) source = { ...relocated, content_revision: revision }
    }
    return { ...reference, source, changed: reference.changed || !referenceMatches(transaction.doc, source, reference.text) }
  }) : previous.references
  for (const step of transaction.steps) {
    if (!(step instanceof ReferenceHistoryStep)) continue
    const snapshots = new Map(step.after.map((reference) => [reference.id, reference]))
    references = references.map((reference) => {
      const saved = snapshots.get(reference.id)
      if (!saved) return reference
      const source = { ...saved.source, content_revision: revision }
      return { ...reference, source, changed: saved.changed || !referenceMatches(transaction.doc, source, reference.text) }
    })
  }
  const action = transaction.getMeta(referenceTrackerKey) as ReferenceAction | undefined
  if (action?.type === "add" && action.reference.source.kind === "canvas") {
    references = [...references.filter((reference) => reference.id !== action.reference.id), {
      id: action.reference.id,
      ordinal: action.reference.ordinal,
      source: { ...action.reference.source, content_revision: revision },
      text: action.reference.text,
      changed: !referenceMatches(transaction.doc, action.reference.source, action.reference.text),
    }]
  } else if (action?.type === "remove") references = references.filter((reference) => reference.id !== action.id)
  else if (action?.type === "renumber") {
    const ordinals = new Map(action.ordinals.map(({ id, ordinal }) => [id, ordinal]))
    references = references.map((reference) => ({ ...reference, ordinal: ordinals.get(reference.id) ?? reference.ordinal }))
  }
  return { revision, references }
}

export const ReferenceTracker = Extension.create({
  name: "editorReferenceTracker",
  addProseMirrorPlugins() {
    return [new Plugin<ReferenceState>({
      key: referenceTrackerKey,
      state: { init: () => ({ revision: 0, references: [] }), apply: updateReferenceState },
      props: {
        decorations(state) {
          const references = referenceTrackerKey.getState(state)?.references ?? []
          return DecorationSet.create(state.doc, references.filter((reference) => !reference.changed).flatMap((reference) => [
            Decoration.inline(reference.source.from, reference.source.to, {
              class: "td-editor-reference-highlight rounded-sm bg-primary/15",
              "data-editor-reference-highlight": reference.id,
            }),
            Decoration.widget(reference.source.from, () => {
              const marker = document.createElement("span")
              marker.setAttribute("data-editor-reference-marker", reference.id)
              marker.setAttribute("aria-hidden", "true")
              marker.className = "pointer-events-none relative inline-block w-0 select-none"
              const number = document.createElement("span")
              number.className = "absolute left-0 -top-5 inline-flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground"
              number.textContent = String(reference.ordinal)
              marker.appendChild(number)
              return marker
            }, { key: `${reference.id}:${reference.ordinal}`, side: -1 }),
          ]))
        },
      },
    })]
  },
})
