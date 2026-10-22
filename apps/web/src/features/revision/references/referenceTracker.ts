import { Extension } from "@tiptap/core"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"
import type { EditorReference } from "@typedance/contracts"
import type { CanvasReferenceSource, TrackedCanvasReference } from "./EditorReferences"

export type TrackedReference = TrackedCanvasReference & { text: string; ordinal: number }
type ReferenceState = { revision: number; references: TrackedReference[] }
type ReferenceAction = { type: "add"; reference: EditorReference } | { type: "remove"; id: string } | { type: "renumber"; ordinals: Pick<EditorReference, "id" | "ordinal">[] }
export const referenceTrackerKey = new PluginKey<ReferenceState>("typedance-editor-references")

export function referenceMatches(doc: ProseMirrorNode, source: CanvasReferenceSource, text: string): boolean {
  if (source.from < 0 || source.to > doc.content.size || source.to <= source.from) return false
  return doc.textBetween(source.from, source.to, "\n", "\n") === text
    && JSON.stringify(doc.slice(source.from, source.to).content.toJSON() ?? []) === JSON.stringify(source.slice_content)
}

export function updateReferenceState(transaction: Transaction, previous: ReferenceState): ReferenceState {
  const revision = previous.revision + (transaction.docChanged ? 1 : 0)
  let references = transaction.docChanged ? previous.references.map((reference) => {
    const from = transaction.mapping.map(reference.source.from, 1)
    const to = transaction.mapping.map(reference.source.to, -1)
    const source = { ...reference.source, from, to, content_revision: revision }
    return { ...reference, source, changed: reference.changed || !referenceMatches(transaction.doc, source, reference.text) }
  }) : previous.references
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
