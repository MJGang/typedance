import { useEffect, useRef, useState } from "react"
import type { Editor } from "@tiptap/core"
import { Fragment } from "@tiptap/pm/model"
import { closeHistory } from "@tiptap/pm/history"
import { TextSelection, type Transaction } from "@tiptap/pm/state"
import type { EditorReference } from "@typedance/contracts"
import { toast } from "sonner"
import { useEditorReferences, type CanvasReferenceBridge } from "./EditorReferences"
import { referenceMatches, referenceTrackerKey } from "./referenceTracker"
import { ReferenceSelectionPopover } from "./ReferenceSelectionPopover"
import { prepareCanvasPrintSnapshot } from "../canvasPrintSnapshot"

type CanvasSelection = Pick<EditorReference, "text" | "label" | "source"> & { rect: DOMRect; key: string }

function selectionLabel(editor: Editor, position: number) {
  let title = "正文"
  let paragraph = 0
  editor.state.doc.descendants((node, nodePosition) => {
    if (nodePosition > position) return false
    if (node.type.name === "heading") { title = node.textContent || "标题"; paragraph = 0 }
    else if (node.isTextblock) paragraph++
  })
  return `${title.slice(0, 130)} · 第 ${Math.max(1, paragraph)} 段`
}

export function CanvasReferences({ editor, canvasVersion }: { editor: Editor | null; canvasVersion: number }) {
  const context = useEditorReferences()
  const [selection, setSelection] = useState<CanvasSelection | null>(null)
  const sessionId = useRef(crypto.randomUUID())
  const version = useRef(canvasVersion)
  version.current = canvasVersion
  const contextRef = useRef(context)
  contextRef.current = context
  const registerCanvas = context?.registerCanvas
  const documentId = context?.documentId

  useEffect(() => {
    if (!editor || !registerCanvas || !documentId) return
    const getState = () => referenceTrackerKey.getState(editor.state)
    const appliedReferences = new Map<string, EditorReference>()
    const bridge: CanvasReferenceBridge = {
      getSnapshot: async () => {
        const printSnapshot = await prepareCanvasPrintSnapshot(editor.view.dom)
        if (editor.isDestroyed) throw new Error("编辑器已切换，请重新发送")
        return { document_id: documentId, editor_session_id: sessionId.current, content_revision: getState()?.revision ?? 0,
          canvas_version: version.current, doc_json: editor.getJSON(), plain_text: editor.getText({ blockSeparator: "\n" }), print_snapshot: printSnapshot }
      },
      getRevision: () => getState()?.revision ?? 0,
      track: (reference) => editor.view.dispatch(editor.state.tr.setMeta(referenceTrackerKey, { type: "add", reference })),
      untrack: (id) => editor.view.dispatch(editor.state.tr.setMeta(referenceTrackerKey, { type: "remove", id })),
      setOrdinals: (ordinals) => editor.view.dispatch(editor.state.tr.setMeta(referenceTrackerKey, { type: "renumber", ordinals })),
      locate: (reference) => {
        if (reference.source.kind !== "canvas") return false
        const source = getState()?.references.find((item) => item.id === reference.id)?.source ?? reference.source
        if (!referenceMatches(editor.state.doc, source, reference.text)) return false
        if (source.editor_session_id !== sessionId.current && source.canvas_node_id) {
          const resolved = editor.state.doc.resolve(source.from)
          if (resolved.parent.attrs.canvasNodeId !== source.canvas_node_id) return false
        }
        return editor.chain().focus().setTextSelection({ from: source.from, to: source.to }).scrollIntoView().run()
      },
      apply: (reference, preview) => {
        if (preview.document_id !== documentId || preview.reference_id !== reference.id || preview.editor_session_id !== sessionId.current || reference.source.kind !== "canvas") return false
        const tracked = getState()?.references.find((item) => item.id === reference.id)
        if (!tracked || tracked.changed || !referenceMatches(editor.state.doc, tracked.source, preview.original_text)) return false
        appliedReferences.set(preview.id, { ...reference, source: structuredClone(tracked.source) })
        const nodes = preview.replacement_content.map((node) => editor.schema.nodeFromJSON(node))
        const transaction = closeHistory(editor.state.tr).replaceWith(tracked.source.from, tracked.source.to, Fragment.fromArray(nodes))
        transaction.setSelection(TextSelection.near(transaction.doc.resolve(Math.min(transaction.doc.content.size, tracked.source.from + preview.replacement.length))))
        editor.view.dispatch(transaction.scrollIntoView())
        editor.view.dispatch(closeHistory(editor.state.tr))
        return true
      },
      undo: (previewId) => {
        const reference = appliedReferences.get(previewId)
        if (!reference || reference.source.kind !== "canvas" || !editor.commands.undo()) return false
        const restored = { ...reference, source: { ...reference.source, content_revision: getState()?.revision ?? 0 } }
        if (!referenceMatches(editor.state.doc, restored.source, restored.text)) return false
        editor.view.dispatch(editor.state.tr.setMeta(referenceTrackerKey, { type: "add", reference: restored }))
        appliedReferences.delete(previewId)
        return true
      },
    }
    return registerCanvas(bridge)
  }, [editor, registerCanvas, documentId])

  useEffect(() => {
    if (!editor || !documentId) return
    let dragging = false
    let alive = true
    const capture = () => {
      if (!alive || editor.isDestroyed || dragging || !editor.isFocused) return
      const { from, to, empty, $from } = editor.state.selection
      if (empty) { setSelection(null); return }
      const text = editor.state.doc.textBetween(from, to, "\n", "\n")
      if (!text.trim()) { setSelection(null); return }
      let rect: DOMRect
      try {
        const start = editor.view.coordsAtPos(from)
        const end = editor.view.coordsAtPos(to)
        rect = new DOMRect(start.left, end.top, Math.max(1, end.right - start.left), end.bottom - end.top)
      } catch { return }
      let nodeId: string | undefined
      for (let depth = $from.depth; depth > 0; depth--) {
        const value: unknown = $from.node(depth).attrs.canvasNodeId
        if (typeof value === "string" && value) { nodeId = value; break }
      }
      const revision = referenceTrackerKey.getState(editor.state)?.revision ?? 0
      setSelection({ text, label: selectionLabel(editor, from), rect, key: `${from}:${to}:${revision}`,
        source: { kind: "canvas", editor_session_id: sessionId.current, content_revision: revision, from, to,
          canvas_node_id: nodeId, slice_content: editor.state.doc.slice(from, to).content.toJSON() ?? [] } })
    }
    const onTransaction = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.docChanged || transaction.getMeta(referenceTrackerKey)) contextRef.current?.updateTracked(referenceTrackerKey.getState(editor.state)?.references ?? [])
    }
    const pointerDown = (event: PointerEvent) => { if (editor.view.dom.contains(event.target as Node)) dragging = true }
    const pointerUp = () => { if (dragging) { dragging = false; queueMicrotask(capture) } }
    editor.on("selectionUpdate", capture)
    editor.on("transaction", onTransaction)
    document.addEventListener("pointerdown", pointerDown, true)
    document.addEventListener("pointerup", pointerUp, true)
    document.addEventListener("scroll", capture, true)
    window.addEventListener("resize", capture)
    return () => {
      alive = false
      editor.off("selectionUpdate", capture)
      editor.off("transaction", onTransaction)
      document.removeEventListener("pointerdown", pointerDown, true)
      document.removeEventListener("pointerup", pointerUp, true)
      document.removeEventListener("scroll", capture, true)
      window.removeEventListener("resize", capture)
    }
  }, [editor, documentId])

  if (!context || !selection) return null
  return <ReferenceSelectionPopover key={selection.key} rect={selection.rect} onClose={() => setSelection(null)} onAdd={(comment) => {
    if (selection.text.length > 4000) { toast.error("每处引用最多 4000 字，请缩小选择范围。"); return }
    context.add({ text: selection.text, label: selection.label, source: selection.source, comment })
    setSelection(null)
  }} />
}
