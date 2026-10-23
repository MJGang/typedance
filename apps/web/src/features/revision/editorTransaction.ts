import type { Editor } from "@tiptap/core"
import { closeHistory } from "@tiptap/pm/history"
import { Fragment, Slice, type Node as ProseMirrorNode } from "@tiptap/pm/model"
import type { Transaction } from "@tiptap/pm/state"
import { ReplaceAroundStep } from "@tiptap/pm/transform"
import { diffArrays, diffChars } from "diff"
import type { EditorTransaction } from "@typedance/contracts"
import { preserveReferenceHistory, referenceTrackerKey } from "./references/referenceTracker"

const diffLimits = { timeout: 250 }
const diffError = "改动范围较大，无法安全保留编辑位置，请分批修改"

function syncMarks(tr: Transaction, from: number, to: number, node: ProseMirrorNode) {
  tr.removeMark(from, to)
  for (const mark of node.marks) tr.addMark(from, to, mark)
}

function syncText(tr: Transaction, before: ProseMirrorNode, after: ProseMirrorNode, position: number) {
  const changes = diffChars(before.text!, after.text!, diffLimits)
  if (!changes) throw new Error(diffError)
  for (const change of changes) {
    const length = change.value.length // ProseMirror 位置按 UTF-16；diff 的 count 按 Unicode code point。
    if (change.removed) tr.delete(position, position + length)
    else {
      if (change.added) tr.insert(position, after.type.schema.text(change.value, after.marks))
      else if (!before.sameMarkup(after)) syncMarks(tr, position, position + length, after)
      position += length
    }
  }
}

const identities = new WeakMap<ProseMirrorNode, string | null>()
function nodeIdentity(node: ProseMirrorNode): string | null {
  if (identities.has(node)) return identities.get(node)!
  const id: unknown = node.attrs.canvasNodeId
  const children: string[] = []
  if (!id) node.descendants((child) => { if (typeof child.attrs.canvasNodeId === "string" && child.attrs.canvasNodeId) children.push(child.attrs.canvasNodeId) })
  const identity = typeof id === "string" && id ? `node:${id}` : children.length ? `${node.type.name}:${JSON.stringify(children)}` : null
  identities.set(node, identity)
  return identity
}

function matchesNode(before: ProseMirrorNode, after: ProseMirrorNode): boolean {
  const identity = nodeIdentity(before)
  return before.eq(after) || (identity !== null && identity === nodeIdentity(after))
}

function alignConstrainedChildren(tr: Transaction, before: ProseMirrorNode, after: ProseMirrorNode, position: number) {
  const children = [...before.content.content]
  if (!children.length || children.length !== after.childCount) return before
  // 有数量限制的容器不能先插入再删除。纯重排用单个保留间隙的原生 step 移动，避免中间状态越界。
  if (after.type.validContent(Fragment.fromArray([...children, ...children])) && after.type.validContent(Fragment.fromArray(children.slice(1)))) return before
  const used = new Set<number>()
  for (const node of after.content.content) {
    const index = children.findIndex((child, candidate) => !used.has(candidate) && matchesNode(child, node))
    if (index < 0) return before
    used.add(index)
  }
  for (let index = 0; index < children.length; index++) {
    const source = children.findIndex((child, candidate) => candidate >= index && matchesNode(child, after.child(index)))
    if (source < 0) throw new Error("无法安全调整内容顺序，请重新读取画布")
    if (source === index) continue
    const start = position + children.slice(0, index).reduce((size, node) => size + node.nodeSize, 0)
    const gapEnd = start + children.slice(index, source).reduce((size, node) => size + node.nodeSize, 0)
    const moving = children[source]
    tr.step(new ReplaceAroundStep(start, gapEnd + moving.nodeSize, start, gapEnd, new Slice(Fragment.from(moving), 0, 0), moving.nodeSize))
    children.splice(source, 1)
    children.splice(index, 0, moving)
  }
  return before.copy(Fragment.fromArray(children))
}

function syncNode(tr: Transaction, before: ProseMirrorNode, after: ProseMirrorNode, position: number) {
  if (before.eq(after)) return
  if (before.isText && after.isText) { syncText(tr, before, after, position); return }
  if (before.isText || after.isText || before.isLeaf !== after.isLeaf || !after.type.validContent(before.content)) {
    tr.replaceWith(position, position + before.nodeSize, after)
    return
  }
  if (!before.sameMarkup(after)) tr.setNodeMarkup(position, after.type, after.attrs, after.marks)
  // 加粗等格式变化不替换文字；即使文本节点因标记拆分，也保留段内引用和光标位置。
  if (before.isTextblock && after.isTextblock && Fragment.fromArray(before.content.content.map((node) => node.mark([])))
    .eq(Fragment.fromArray(after.content.content.map((node) => node.mark([]))))) {
    let offset = position + 1
    after.forEach((node) => { syncMarks(tr, offset, offset + node.nodeSize, node); offset += node.nodeSize })
    return
  }
  syncChildren(tr, before, after, position + 1)
}

function syncChildren(tr: Transaction, before: ProseMirrorNode, after: ProseMirrorNode, position: number) {
  before = alignConstrainedChildren(tr, before, after, position)
  const changes = diffArrays([...before.content.content], [...after.content.content], { comparator: matchesNode, ...diffLimits })
  if (!changes) throw new Error(diffError)
  let oldIndex = 0
  let newIndex = 0
  let removed: ProseMirrorNode[] = []
  let added: ProseMirrorNode[] = []
  const flush = () => {
    const paired = Math.min(removed.length, added.length)
    for (let index = 0; index < paired; index++) {
      syncNode(tr, removed[index], added[index], position)
      position += added[index].nodeSize
    }
    const deletedSize = removed.slice(paired).reduce((size, node) => size + node.nodeSize, 0)
    if (deletedSize) tr.delete(position, position + deletedSize)
    const inserted = Fragment.fromArray(added.slice(paired))
    if (inserted.size) { tr.insert(position, inserted); position += inserted.size }
    removed = []
    added = []
  }
  for (const change of changes) {
    const count = change.value.length
    if (change.removed) { removed.push(...before.content.content.slice(oldIndex, oldIndex + count)); oldIndex += count }
    else if (change.added) { added.push(...after.content.content.slice(newIndex, newIndex + count)); newIndex += count }
    else {
      flush()
      for (let index = 0; index < count; index++) {
        const next = after.child(newIndex++)
        syncNode(tr, before.child(oldIndex++), next, position)
        position += next.nodeSize
      }
    }
  }
  flush()
}

/** 与手动编辑共用 ProseMirror 事务及历史，不通过 setContent 重建编辑器。 */
export function applyEditorTransaction(editor: Editor, documentId: string, sessionId: string, transaction: EditorTransaction): boolean {
  if (editor.isDestroyed || !editor.isEditable || transaction.document_id !== documentId || transaction.editor_session_id !== sessionId
    || transaction.content_revision !== (referenceTrackerKey.getState(editor.state)?.revision ?? 0)) throw new Error("画布或编辑会话已变化，请重新读取后操作")
  const before = editor.schema.nodeFromJSON(transaction.before_doc_json)
  if (!before.eq(editor.state.doc)) throw new Error("原文已变化，已阻止覆盖你的编辑")
  return applyDocumentChange(editor, transaction.before_doc_json, transaction.doc_json, transaction.id)
}

export function applyDocumentChange(editor: Editor, beforeJson: Record<string, unknown>, afterJson: Record<string, unknown>, transactionId: string): boolean {
  if (editor.isDestroyed || !editor.isEditable) throw new Error("编辑器不可用")
  const before = editor.schema.nodeFromJSON(beforeJson)
  if (!before.eq(editor.state.doc)) throw new Error("原文已变化，已阻止覆盖你的编辑")
  const after = editor.schema.nodeFromJSON(afterJson)
  after.check()
  if (before.eq(after)) return false
  const tr = closeHistory(editor.state.tr)
  syncChildren(tr, before, after, 0)
  for (const key of Object.keys(after.attrs)) {
    if (JSON.stringify(before.attrs[key]) !== JSON.stringify(after.attrs[key])) tr.setDocAttribute(key, after.attrs[key])
  }
  if (!tr.doc.eq(after)) throw new Error("编辑结果与准备事务不一致，未应用修改")
  preserveReferenceHistory(tr, referenceTrackerKey.getState(editor.state))
  editor.view.dispatch(tr.setMeta("typedance-editor-transaction", transactionId).scrollIntoView())
  editor.view.dispatch(closeHistory(editor.state.tr))
  return true
}
