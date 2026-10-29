import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react"
import type { EditorReference, EditorSnapshot, EditorTransaction, EditorRequest, EditorResponse } from "@typedance/contracts"
import { toast } from "sonner"
import { assertAccountSession, captureAccountSession } from "@/accountSession"
import { flushSourceCanvasSaves } from "../useSourceCanvasAutosave"

export type CanvasReferenceSource = Extract<EditorReference["source"], { kind: "canvas" }>
export type TrackedCanvasReference = { id: string; source: CanvasReferenceSource; changed: boolean }
export type PendingReference = { reference: EditorReference; changed: boolean }

export type CanvasReferenceBridge = {
  getSnapshot: (includePrint?: boolean) => Promise<EditorSnapshot>
  track: (reference: EditorReference) => void
  untrack: (id: string) => void
  setOrdinals: (ordinals: Pick<EditorReference, "id" | "ordinal">[]) => void
  locate: (reference: EditorReference) => boolean
  apply: (transaction: EditorTransaction) => boolean
  undo: () => boolean
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
  getPayload: () => Promise<{ references: EditorReference[]; snapshot?: EditorSnapshot }>
  locate: (reference: EditorReference) => void
  handleRequest: (request: EditorRequest, approved: boolean) => Promise<EditorResponse>
  completeRequest: (requestId: string) => void
  undo: (previewId: string) => boolean
}

const EditorReferencesContext = createContext<EditorReferencesValue | null>(null)

export function useEditorReferences() {
  return useContext(EditorReferencesContext)
}

export function EditorReferencesProvider({ documentId, children, onReferenceAdded }: { documentId: string; children: ReactNode; onReferenceAdded?: () => void }) {
  const [pending, setPending] = useState<PendingReference[]>([])
  const pendingRef = useRef(pending)
  const known = useRef(new Map<string, PendingReference>())
  const canvas = useRef<CanvasReferenceBridge | null>(null)
  const composerFocus = useRef<(() => void) | null>(null)
  const applications = useRef(new Map<string, { bridge: CanvasReferenceBridge; revision: number }>())
  const completedRequests = useRef(new Map<string, Promise<EditorResponse>>())
  const onAdded = useRef(onReferenceAdded)
  onAdded.current = onReferenceAdded

  const commitPending = useCallback((items: PendingReference[]) => {
    const ordinals: Pick<EditorReference, "id" | "ordinal">[] = []
    const next = items.map((item, index) => {
      const latest = known.current.get(item.reference.id) ?? item
      const ordinal = index + 1
      if (latest.reference.source.kind === "canvas" && latest.reference.ordinal !== ordinal) ordinals.push({ id: latest.reference.id, ordinal })
      const updated = { ...latest, reference: { ...latest.reference, ordinal } }
      known.current.set(updated.reference.id, updated)
      return updated
    })
    pendingRef.current = next
    if (ordinals.length) canvas.current?.setOrdinals(ordinals)
    setPending(next)
  }, [])
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
    const reference: EditorReference = { ...input, id: crypto.randomUUID(), ordinal: pendingRef.current.length + 1, document_id: documentId }
    const item = { reference, changed: false }
    known.current.set(reference.id, item)
    if (reference.source.kind === "canvas") canvas.current?.track(reference)
    commitPending([...pendingRef.current, known.current.get(reference.id) ?? item])
    onAdded.current?.()
    composerFocus.current?.()
  }, [documentId, commitPending])
  const updateTracked = useCallback((tracked: TrackedCanvasReference[]) => {
    let changed = false
    for (const item of tracked) {
      const existing = known.current.get(item.id)
      if (!existing) continue
      known.current.set(item.id, { reference: { ...existing.reference, source: item.source }, changed: item.changed })
      if (pendingRef.current.some((pendingItem) => pendingItem.reference.id === item.id && pendingItem.changed !== item.changed)) changed = true
    }
    if (changed) commitPending(pendingRef.current)
  }, [commitPending])
  const editComment = useCallback((id: string, comment: string) => {
    const existing = known.current.get(id)
    if (!existing) return
    const next = { ...existing, reference: { ...existing.reference, comment } }
    known.current.set(id, next)
    commitPending(pendingRef.current)
  }, [commitPending])
  const remove = useCallback((id: string) => {
    canvas.current?.untrack(id)
    known.current.delete(id)
    commitPending(pendingRef.current.filter((item) => item.reference.id !== id))
  }, [commitPending])
  const clear = useCallback(() => {
    for (const item of pendingRef.current) {
      canvas.current?.untrack(item.reference.id)
      known.current.delete(item.reference.id)
    }
    commitPending([])
  }, [commitPending])
  const consume = useCallback((ids: string[]) => {
    const sentIds = new Set(ids)
    commitPending(pendingRef.current.filter((item) => !sentIds.has(item.reference.id)))
  }, [commitPending])
  const getPayload = useCallback(async () => {
    const snapshot = await canvas.current?.getSnapshot()
    const references = pendingRef.current.map((item) => {
      const latest = known.current.get(item.reference.id) ?? item
      if (latest.changed) throw new Error("引用的原文已修改，请删除该引用后重新选择。")
      return structuredClone(latest.reference)
    })
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
  const handleRequest = useCallback((request: EditorRequest, approved: boolean): Promise<EditorResponse> => {
    const previous = completedRequests.current.get(request.id)
    if (previous) return previous
    const task = (async (): Promise<EditorResponse> => {
      const bridge = canvas.current
      if (!bridge || request.document_id !== documentId) return { status: "failed", error: "当前画布不可用或已切换" }
      let applied = false
      let persisted = false
      let unchanged = false
      let appliedSnapshot: EditorSnapshot | undefined
      try {
        const session = captureAccountSession()
        const activity = session.activitySignal
        assertAccountSession(session)
        if (activity.aborted) throw new Error("账号活动已暂停，未应用画布修改。")
        if (request.kind === "transaction" && !approved) return { status: "rejected" }
        if (request.kind === "transaction") {
          if (!request.transaction) throw new Error("缺少编辑事务")
          applied = bridge.apply(request.transaction)
          unchanged = !applied
          if (applied) {
            applications.current.set(request.transaction.id, { bridge, revision: bridge.getRevision() })
            toast.success("修改已应用，可撤销")
            appliedSnapshot = await bridge.getSnapshot(false)
            if (!await flushSourceCanvasSaves(documentId)) throw new Error("后端保存失败，请使用画布上的重试保存，勿重复应用修改")
            persisted = true
          }
        }
        const snapshot = await bridge.getSnapshot()
        if ((request.kind === "transaction" && snapshot.editor_session_id !== request.editor_session_id) || canvas.current !== bridge) throw new Error("编辑会话已切换")
        return { status: request.kind === "snapshot" ? "snapshot" : unchanged ? "unchanged" : "applied", snapshot, ...(applied ? { persisted } : {}) }
      } catch (error) {
        const message = error instanceof Error ? error.message : "编辑器操作失败"
        if (applied && appliedSnapshot) {
          // 写入成功与截图成功分别报告，不能因观察失败而重复应用同一事务。
          return { status: "applied", persisted, snapshot: appliedSnapshot, error: `已修改，保存或排版复查未完成：${message}` }
        }
        return { status: "failed", error: message }
      }
    })()
    completedRequests.current.set(request.id, task)
    return task
  }, [documentId])
  const completeRequest = useCallback((requestId: string) => { completedRequests.current.delete(requestId) }, [])
  const undo = useCallback((previewId: string) => {
    const application = applications.current.get(previewId)
    if (!canvas.current || application?.bridge !== canvas.current || application.revision !== canvas.current.getRevision()) {
      toast.message("已有后续编辑，请使用编辑器的撤销操作。")
      return false
    }
    return canvas.current.undo()
  }, [])
  const value = useMemo(() => ({ documentId, pending, registerCanvas, registerComposer, updateTracked, add, editComment, remove, clear, consume, getPayload, locate, handleRequest, completeRequest, undo }),
    [documentId, pending, registerCanvas, registerComposer, updateTracked, add, editComment, remove, clear, consume, getPayload, locate, handleRequest, completeRequest, undo])
  return <EditorReferencesContext.Provider value={value}>{children}</EditorReferencesContext.Provider>
}
