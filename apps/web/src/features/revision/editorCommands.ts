import type { Editor } from "@tiptap/core"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import type { EditorOperation, TemplateStyleConfig } from "@typedance/contracts"
import { toast } from "sonner"
import { prepareEditorOperations } from "@/api"
import { applyDocumentChange } from "./editorTransaction"

/** 原生选择范围是 UI 状态；所有持久化文档变换交给共享业务能力执行器。 */
export function selectedNodePaths(editor: Editor, kinds: string[]): number[][] {
  const { from, to } = editor.state.selection
  const paths: number[][] = []
  function visit(parent: ProseMirrorNode, path: number[], base: number) {
    parent.forEach((node, offset, index) => {
      const position = base + offset
      if (position + node.nodeSize <= from || position >= to) return
      const next = [...path, index]
      if (kinds.includes(node.type.name)) paths.push(next)
      else if (!node.isLeaf) visit(node, next, position + 1)
    })
  }
  visit(editor.state.doc, [], 0)
  return paths
}

export function nodePathAtPosition(editor: Editor, position: number): number[] | undefined {
  if (position < 0 || position >= editor.state.doc.content.size || !editor.state.doc.nodeAt(position)) return undefined
  const resolved = editor.state.doc.resolve(position)
  return Array.from({ length: resolved.depth + 1 }, (_, depth) => resolved.index(depth))
}

export function selectedColumnsPath(editor: Editor): number[] | undefined {
  const { $from, from } = editor.state.selection
  if (editor.state.doc.nodeAt(from)?.type.name === "columns") return nodePathAtPosition(editor, from)
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === "columns") return nodePathAtPosition(editor, $from.before(depth))
  }
  return undefined
}

export function selectedTextOperations(editor: Editor, mark: string, enabled: boolean, attributes?: Record<string, unknown>): EditorOperation[] {
  const { from, to } = editor.state.selection
  const operations: EditorOperation[] = []
  function visit(parent: ProseMirrorNode, path: number[], base: number) {
    parent.forEach((node, offset, index) => {
      const position = base + offset
      if (position + node.nodeSize <= from || position >= to) return
      const next = [...path, index]
      if (node.isTextblock) {
        const start = Math.max(0, from - position - 1)
        const end = Math.min(node.content.size, to - position - 1)
        if (end <= start) return
        const text = node.textBetween(start, end, "\n", "\n")
        if (!text) return
        const prefix = node.textBetween(0, start, "\n", "\n")
        const full = node.textBetween(0, node.content.size, "\n", "\n")
        let occurrence = 0
        for (let match = full.indexOf(text); match >= 0 && match < prefix.length; match = full.indexOf(text, match + 1)) occurrence++
        operations.push({ capability: "text.format", parameters: { path: next, text, occurrence, mark, enabled, ...(attributes ? { attributes } : {}) } })
      } else if (!node.isLeaf) visit(node, next, position + 1)
    })
  }
  visit(editor.state.doc, [], 0)
  return operations
}

export async function executeEditorOperations(editor: Editor, operations: EditorOperation[], templateStyle?: TemplateStyleConfig, options: { focus?: boolean } = {}): Promise<boolean> {
  if (!operations.length || editor.isDestroyed || !editor.isEditable) return false
  const before = editor.getJSON()
  try {
    const result = await prepareEditorOperations(before, operations, templateStyle)
    applyDocumentChange(editor, before, result.doc_json, crypto.randomUUID(), result.node_origins, result.text_origins)
    if (options.focus !== false) editor.commands.focus()
    return true
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "编辑操作失败")
    return false
  }
}
