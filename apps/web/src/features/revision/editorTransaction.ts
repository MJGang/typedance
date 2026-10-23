import type { Editor } from "@tiptap/core"
import { closeHistory } from "@tiptap/pm/history"
import type { EditorTransaction } from "@typedance/contracts"
import { referenceTrackerKey } from "./references/referenceTracker"

/** 与手动编辑共用 ProseMirror 事务及历史，不通过 setContent 重建编辑器。 */
export function applyEditorTransaction(editor: Editor, documentId: string, sessionId: string, transaction: EditorTransaction): void {
  if (editor.isDestroyed || !editor.isEditable || transaction.document_id !== documentId || transaction.editor_session_id !== sessionId
    || transaction.content_revision !== (referenceTrackerKey.getState(editor.state)?.revision ?? 0)) throw new Error("画布或编辑会话已变化，请重新读取后操作")
  const before = editor.schema.nodeFromJSON(transaction.before_doc_json)
  if (!before.eq(editor.state.doc)) throw new Error("原文已变化，已阻止覆盖你的编辑")
  applyDocumentChange(editor, transaction.before_doc_json, transaction.doc_json, transaction.id)
}

export function applyDocumentChange(editor: Editor, beforeJson: Record<string, unknown>, afterJson: Record<string, unknown>, transactionId: string): void {
  if (editor.isDestroyed || !editor.isEditable) throw new Error("编辑器不可用")
  const before = editor.schema.nodeFromJSON(beforeJson)
  if (!before.eq(editor.state.doc)) throw new Error("原文已变化，已阻止覆盖你的编辑")
  const after = editor.schema.nodeFromJSON(afterJson)
  after.check()
  const tr = closeHistory(editor.state.tr)
  const start = before.content.findDiffStart(after.content)
  if (start !== null) {
    const end = before.content.findDiffEnd(after.content)!
    const overlap = start - Math.min(end.a, end.b)
    tr.replace(start, end.a + Math.max(0, overlap), after.slice(start, end.b + Math.max(0, overlap)))
  }
  for (const key of Object.keys(after.attrs)) {
    if (JSON.stringify(before.attrs[key]) !== JSON.stringify(after.attrs[key])) tr.setDocAttribute(key, after.attrs[key])
  }
  if (!tr.doc.eq(after)) throw new Error("编辑结果与准备事务不一致，未应用修改")
  editor.view.dispatch(tr.setMeta("typedance-editor-transaction", transactionId).scrollIntoView())
  editor.view.dispatch(closeHistory(editor.state.tr))
}
