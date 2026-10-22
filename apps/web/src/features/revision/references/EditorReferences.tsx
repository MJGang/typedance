import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react"
import type { EditorReference, EditorSnapshot, TextEditPreview } from "@typedance/contracts"
import { toast } from "sonner"

export type CanvasReferenceSource = Extract<EditorReference["source"], { kind: "canvas" }>
export type TrackedCanvasReference = { id: string; source: CanvasReferenceSource; changed: boolean }
export type PendingReference = { reference: EditorReference; changed: boolean }

export type CanvasReferenceBridge = {
  getSnapshot: () => EditorSnapshot
  track: (reference: EditorReference) => void
  untrack: (id: string) => void
  locate: (reference: EditorReference) => boolean
  apply: (reference: EditorReference, preview: TextEditPreview) => boolean
  undo: (previewId: string) => boolean
  getRevision: () => number
}

type EditorReferencesValue = {
  documentId: string
  pending: PendingReference[]
  registerCanvas: (bridge: CanvasReferenceBridge) => () => void
  registerComposer: (focus: () => void) => () => void
  updateTracked: (references: TrackedCanvasReference[]) => void
  add: (input: Pick<EditorReference, "text" | "label" | "source" | "comment">) => void
  editComment: (id: string, comment: string) => void
  remove: (id: string) => void
  clear: () => void
  consume: (ids: string[]) => void
  getPayload: () => { references: EditorReference[]; snapshot?: EditorSnapshot }
  locate: (reference: EditorReference) => void
  apply: (preview: TextEditPreview) => boolean
  undo: (previewId: string) => boolean
}

const EditorReferencesContext = createContext<EditorReferencesValue | null>(null)

export function useEditorReferences() {
  return useContext(EditorReferencesContext)
}

export function EditorReferencesProvider({ documentId, children, onReferenceAdded }: { documentId: string; children: ReactNode; onReferenceAdded?: () => void }) {
  const [pending, setPending] = useState<PendingReference[]>([])
  const pendingRef = useRef(pending)
  pendingRef.current = pending
  const known = useRef(new Map<string, PendingReference>())
  const ordinal = useRef(0)
  const canvas = useRef<CanvasReferenceBridge | null>(null)
  const composerFocus = useRef<(() => void) | null>(null)
  const applications = useRef(new Map<string, number>())
  const onAdded = useRef(onReferenceAdded)
  onAdded.current = onReferenceAdded

  const registerCanvas = useCallback((bridge: CanvasReferenceBridge) => {
    canvas.current = bridge
    return () => { if (canvas.current === bridge) canvas.current = null }
  }, [])
  const registerComposer = useCallback((focus: () => void) => {
    composerFocus.current = focus
    if (pendingRef.current.length > 0) focus()
    return () => { if (composerFocus.current === focus) composerFocus.current = null }
  }, [])
  const add = useCallback((input: Pick<EditorReference, "text" | "label" | "source" | "comment">) => {
    if (pendingRef.current.length >= 12) { toast.error("一次最多引用 12 处内容"); return }
    const reference: EditorReference = { ...input, id: crypto.randomUUID(), ordinal: ++ordinal.current, document_id: documentId }
    const item = { reference, changed: false }
    known.current.set(reference.id, item)
    if (reference.source.kind === "canvas") canvas.current?.track(reference)
    setPending((current) => [...current, known.current.get(reference.id) ?? item])
    onAdded.current?.()
    composerFocus.current?.()
  }, [documentId])
  const updateTracked = useCallback((tracked: TrackedCanvasReference[]) => {
    let changed = false
    for (const item of tracked) {
      const existing = known.current.get(item.id)
      if (!existing) continue
      known.current.set(item.id, { reference: { ...existing.reference, source: item.source }, changed: item.changed })
      if (pendingRef.current.some((pendingItem) => pendingItem.reference.id === item.id && pendingItem.changed !== item.changed)) changed = true
    }
    if (changed) setPending((current) => current.map((item) => known.current.get(item.reference.id) ?? item))
  }, [])
  const editComment = useCallback((id: string, comment: string) => {
    const existing = known.current.get(id)
    if (!existing) return
    const next = { ...existing, reference: { ...existing.reference, comment } }
    known.current.set(id, next)
    setPending((current) => current.map((item) => item.reference.id === id ? next : item))
  }, [])
  const remove = useCallback((id: string) => {
    canvas.current?.untrack(id)
    known.current.delete(id)
    setPending((current) => current.filter((item) => item.reference.id !== id))
  }, [])
  const clear = useCallback(() => {
    for (const item of pendingRef.current) {
      canvas.current?.untrack(item.reference.id)
      known.current.delete(item.reference.id)
    }
    setPending([])
  }, [])
  const consume = useCallback((ids: string[]) => {
    const sentIds = new Set(ids)
    setPending((current) => current.filter((item) => !sentIds.has(item.reference.id)))
  }, [])
  const getPayload = useCallback(() => {
    const references = pendingRef.current.map((item) => {
      const latest = known.current.get(item.reference.id) ?? item
      if (latest.changed) throw new Error("引用的原文已修改，请删除该引用后重新选择。")
      return structuredClone(latest.reference)
    })
    const snapshot = canvas.current?.getSnapshot()
    return { references, snapshot }
  }, [])
  const locate = useCallback((reference: EditorReference) => {
    if (reference.source.kind === "canvas") {
      const current = known.current.get(reference.id)
      if (current?.changed || !canvas.current?.locate(current?.reference ?? reference)) toast.error("原文已修改或当前编辑器已切换，请重新选择。")
      return
    }
    const source = reference.source
    const target = Array.from(document.querySelectorAll<HTMLElement>("[data-agent-message-id]"))
      .find((element) => element.dataset.agentMessageId === source.message_id)
    if (target) target.scrollIntoView({ block: "center", behavior: "smooth" })
    else toast.message("这条引用来自其他对话，原文仍保留在引用卡片中。")
  }, [])
  const apply = useCallback((preview: TextEditPreview) => {
    const reference = known.current.get(preview.reference_id)
    if (!canvas.current || !reference || reference.changed || !canvas.current.apply(reference.reference, preview)) {
      toast.error("原文已修改或编辑器已重新打开，请重新引用后生成建议。")
      return false
    }
    applications.current.set(preview.id, canvas.current.getRevision())
    toast.success("修改已应用，可撤销")
    return true
  }, [])
  const undo = useCallback((previewId: string) => {
    if (!canvas.current || applications.current.get(previewId) !== canvas.current.getRevision()) {
      toast.message("已有后续编辑，请使用编辑器的撤销操作。")
      return false
    }
    return canvas.current.undo(previewId)
  }, [])
  const value = useMemo(() => ({ documentId, pending, registerCanvas, registerComposer, updateTracked, add, editComment, remove, clear, consume, getPayload, locate, apply, undo }),
    [documentId, pending, registerCanvas, registerComposer, updateTracked, add, editComment, remove, clear, consume, getPayload, locate, apply, undo])
  return <EditorReferencesContext.Provider value={value}>{children}</EditorReferencesContext.Provider>
}
