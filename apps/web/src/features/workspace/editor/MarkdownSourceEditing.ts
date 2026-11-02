import { Extension, type Editor, type JSONContent } from "@tiptap/core"
import type { Node as ProseMirrorNode, NodeType, Schema } from "@tiptap/pm/model"
import { closeHistory } from "@tiptap/pm/history"
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state"
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view"
import { Transform } from "@tiptap/pm/transform"
import { diffChars } from "diff"
import { applyDocumentChange } from "../../revision/editorTransaction"
import { parseEditorMarkdown } from "./MarkdownEditing"

type ListContext = { node: JSONContent; before: JSONContent[]; after: JSONContent[]; start: number }
type SourceSession = {
  id: string
  source: string
  parent: number[]
  index: number
  count: number
  paths: number[][]
  list?: ListContext
  caret: number
  pendingMarks?: JSONContent["marks"]
}

export const markdownSourceKey = new PluginKey<SourceSession | null>("markdownSourceEditing")
export const MARKDOWN_SOURCE_SELECTION_EVENT = "typedance:markdown-source-selection"

export function markdownSourceSelectionRect(editor: Editor): DOMRect | undefined {
  const input = editor.view.dom.querySelector<HTMLTextAreaElement>("[data-markdown-source-input]")
  if (input && input.ownerDocument.activeElement === input && markdownSourceKey.getState(editor.state)) return input.getBoundingClientRect()
}

function jsonAt(doc: JSONContent, path: number[]): JSONContent {
  return path.reduce((node, index) => node.content![index], doc)
}

function nodeAtPath(doc: ProseMirrorNode, path: number[]): { node: ProseMirrorNode; position: number } {
  let node = doc, position = -1
  for (const index of path) {
    position += 1
    for (let sibling = 0; sibling < index; sibling++) position += node.child(sibling).nodeSize
    node = node.child(index)
  }
  return { node, position }
}

function firstTextblock(node: ProseMirrorNode, position: number): { node: ProseMirrorNode; position: number } | undefined {
  if (node.isTextblock) return { node, position }
  let result: { node: ProseMirrorNode; position: number } | undefined
  node.forEach((child, offset) => { result ??= firstTextblock(child, position + offset + 1) })
  return result
}

function renderedText(doc: ProseMirrorNode, paths: number[][]) {
  let text = "", blocks = 0
  const positions: number[] = []
  const visit = (node: ProseMirrorNode, position: number) => {
    if (node.isTextblock) {
      if (blocks++) text += "\n"
      const value = node.textBetween(0, node.content.size, "\n", "\n")
      for (let offset = 0; offset < value.length; offset++) positions[text.length + offset] = position + 1 + offset
      text += value
      positions[text.length] = position + 1 + value.length
      return
    }
    node.forEach((child, offset) => visit(child, position + 1 + offset))
  }
  for (const path of paths) { const { node, position } = nodeAtPath(doc, path); visit(node, position) }
  return { text, positions }
}

/** Markdown 标记只属于编辑视图；光标通过文本差异映射回真实文档位置。 */
function sourceOffsets(source: string, rendered: string): number[] {
  const changes = diffChars(source, rendered, { timeout: 100 })
  if (!changes) throw new Error("当前段落过长，请拆分后编辑 Markdown")
  const offsets = [0]
  let raw = 0, plain = 0
  for (const change of changes) {
    if (change.added) { plain += change.value.length; offsets[raw] = plain }
    else for (let index = 0; index < change.value.length; index++) {
      raw++
      if (!change.removed) plain++
      offsets[raw] = plain
    }
  }
  return offsets
}

function documentSelection(doc: ProseMirrorNode, session: SourceSession, start: number, end: number, backward = false) {
  const rendered = renderedText(doc, session.paths)
  const offsets = sourceOffsets(session.source, rendered.text)
  const from = rendered.positions[offsets[start]], to = rendered.positions[offsets[end]]
  if (from !== undefined && to !== undefined) return TextSelection.create(doc, backward ? to : from, backward ? from : to)
}

function preserveAttributes(previous: JSONContent[], blocks: JSONContent[]) {
  const isTextblock = (node: JSONContent) => ["paragraph", "heading", "codeBlock"].includes(node.type ?? "")
  const firstBlock = (node: JSONContent): JSONContent | undefined => isTextblock(node) ? node
    : node.content?.map(firstBlock).find(Boolean)
  const inherit = (original: JSONContent, next: JSONContent) => {
    next.attrs = { ...original.attrs, ...next.attrs }
    for (const key of ["canvasNodeId", "sourceBlockId", "moduleId"]) {
      if (original.attrs?.[key]) next.attrs[key] = original.attrs[key]
    }
  }
  const visit = (original: JSONContent, next: JSONContent) => {
    if (isTextblock(original) && !isTextblock(next)) { inherit(original, firstBlock(next) ?? next); return }
    if (!isTextblock(original) && isTextblock(next)) { inherit(firstBlock(original) ?? original, next); return }
    if (original.type === next.type || (isTextblock(original) && isTextblock(next))) inherit(original, next)
    original.content?.forEach((child, index) => { if (next.content?.[index]) visit(child, next.content[index]) })
  }
  previous.forEach((original, index) => { if (blocks[index]) visit(original, blocks[index]) })
}

/** Markdown 没有颜色、字号等语法；这些已有局部样式随原文和替换文字保留。 */
function preserveInlineStyles(previous: JSONContent[], blocks: JSONContent[], schema: Schema) {
  type Style = NonNullable<JSONContent["marks"]>[number] | null
  const collect = (nodes: JSONContent[]) => {
    let text = "", count = 0
    const styles: Style[] = [], starts = new Map<JSONContent, number>()
    const visit = (node: JSONContent) => {
      if (["paragraph", "heading", "codeBlock"].includes(node.type ?? "") && count++) { text += "\n"; styles.push(null) }
      if (node.type === "text") {
        starts.set(node, text.length)
        const value = node.text ?? ""
        text += value
        const style = node.marks?.find((mark) => mark.type === "inlineStyle") ?? null
        for (let index = 0; index < value.length; index++) styles.push(style)
      } else if (node.type === "hardBreak") { text += "\n"; styles.push(null) }
      else node.content?.forEach(visit)
    }
    nodes.forEach(visit)
    return { text, styles, starts }
  }
  const old = collect(previous), next = collect(blocks)
  if (!old.styles.some(Boolean)) return
  const changes = diffChars(old.text, next.text, { timeout: 100 })
  if (!changes) throw new Error("当前段落过长，请拆分后编辑 Markdown")
  const styles: Style[] = []
  let offset = 0, replacing = false, replacement: Style = null
  for (const change of changes) {
    if (change.removed) { replacement = old.styles[offset] ?? null; offset += change.value.length; replacing = true }
    else if (change.added) {
      const inherited = replacing ? replacement : old.styles[Math.max(0, offset - 1)] ?? null
      for (let index = 0; index < change.value.length; index++) styles.push(inherited)
      replacing = false
    } else {
      for (let index = 0; index < change.value.length; index++) styles.push(old.styles[offset + index])
      offset += change.value.length; replacing = false
    }
  }
  const apply = (nodes: JSONContent[], parent?: NodeType): JSONContent[] => nodes.flatMap((node) => {
    if (node.type !== "text") { if (node.content) node.content = apply(node.content, schema.nodes[node.type ?? ""]); return [node] }
    if (!schema.marks.inlineStyle || !parent?.allowsMarkType(schema.marks.inlineStyle)) return [node]
    if (node.marks?.some((mark) => mark.type === "inlineStyle" || mark.type === "code")) return [node]
    const start = next.starts.get(node)!, text = node.text ?? ""
    const result: JSONContent[] = []
    for (let from = 0; from < text.length;) {
      const style = styles[start + from]
      let to = from + 1
      while (to < text.length && JSON.stringify(styles[start + to]) === JSON.stringify(style)) to++
      result.push({ ...node, text: text.slice(from, to), ...(style ? { marks: [...node.marks ?? [], style] } : {}) })
      from = to
    }
    return result
  })
  blocks.splice(0, blocks.length, ...apply(blocks))
}

function projectSource(editor: Editor, session: SourceSession, source: string) {
  const before = editor.getJSON()
  const after = structuredClone(before)
  const parsed = parseEditorMarkdown(editor, source)
  const blocks = parsed.content?.length ? parsed.content : [{ type: "paragraph", ...(source ? { content: [{ type: "text", text: source }] } : {}) }]
  const previous = session.paths.map((path) => jsonAt(before, path))
  const originalBlocks = previous[0]?.type === "listItem"
    ? [{ ...jsonAt(before, session.paths[0].slice(0, -1)), content: previous }] : previous
  preserveAttributes(originalBlocks, blocks)
  preserveInlineStyles(previous, blocks, editor.schema)
  let replacement = blocks
  let paths = blocks.map((_, offset) => [...session.parent, session.index + offset])
  if (session.list) {
    const { node, before: leading, after: trailing, start } = session.list
    const list = blocks[0]
    if (blocks.length === 1 && list.type === node.type && (list.type !== "orderedList" || (list.attrs?.start ?? 1) === start)) {
      const items = list.content ?? []
      replacement = [{ ...node, content: [...leading, ...items, ...trailing] }]
      paths = items.map((_, offset) => [...session.parent, session.index, leading.length + offset])
    } else {
      const prefix = leading.length ? [{ ...node, content: leading }] : []
      const suffix = trailing.length ? [{ ...node, attrs: { ...node.attrs, ...(node.type === "orderedList" ? { start: start + 1 } : {}) }, content: trailing }] : []
      replacement = [...prefix, ...blocks, ...suffix]
      paths = blocks.map((_, offset) => [...session.parent, session.index + prefix.length + offset])
    }
  }
  jsonAt(after, session.parent).content!.splice(session.index, session.count, ...replacement)
  return { before, after, session: { ...session, source, count: replacement.length, paths } }
}

function serializeSource(editor: Editor, doc: JSONContent, paths: number[][]): string {
  let content = paths.map((path) => jsonAt(doc, path))
  if (content[0]?.type === "listItem") {
    const path = paths[0], list = jsonAt(doc, path.slice(0, -1))
    content = [{ ...list, attrs: { ...list.attrs, start: (list.attrs?.start ?? 1) + path[path.length - 1] }, content }]
  }
  return editor.markdown!.serialize({ type: "doc", content })
}

function startSession(editor: Editor, position: number): SourceSession | null {
  const resolved = editor.state.doc.resolve(position)
  let depth = resolved.depth
  while (depth > 0 && !resolved.node(depth).isTextblock) depth--
  if (!depth || !editor.markdown || !["paragraph", "heading", "codeBlock"].includes(resolved.node(depth).type.name)) return null
  let itemDepth = depth - 1
  while (itemDepth > 0 && resolved.node(itemDepth).type.name !== "listItem") itemDepth--
  const unitDepth = itemDepth || depth
  const path = Array.from({ length: unitDepth }, (_, level) => resolved.index(level))
  const parent = path.slice(0, -1)
  let index = path[path.length - 1]
  let list: ListContext | undefined
  if (itemDepth) {
    const node = resolved.node(itemDepth - 1).toJSON() as JSONContent
    const start = (node.attrs?.start ?? 1) + index
    list = { node, before: node.content!.slice(0, index), after: node.content!.slice(index + 1), start }
    index = parent.pop()!
  }
  const source = serializeSource(editor, editor.getJSON(), [path])
  const pendingMarks = position === editor.state.selection.from ? editor.state.storedMarks?.map((mark) => mark.toJSON()) : undefined
  const session: SourceSession = { id: crypto.randomUUID(), source, parent, index, count: 1, paths: [path], list, caret: 0, pendingMarks }
  const rendered = renderedText(editor.state.doc, session.paths)
  const offset = Math.max(0, rendered.positions.findIndex((value) => value >= position))
  const mapping = sourceOffsets(source, rendered.text)
  session.caret = Math.max(0, mapping.findIndex((value) => value >= offset))
  return session
}

export const MarkdownSourceEditing = Extension.create({
  name: "markdownSourceEditing",
  priority: 1100,
  addProseMirrorPlugins() {
    const editor = this.editor
    let view: EditorView
    let updating = false
    let disposed = false
    const finish = () => {
      let session = markdownSourceKey.getState(view.state)
      if (!session) return
      const input = view.dom.querySelector<HTMLTextAreaElement>("[data-markdown-source-input]")
      if (input && input.value !== session.source) {
        input.dispatchEvent(new Event("typedance:commit-markdown-source"))
        session = markdownSourceKey.getState(view.state)
        if (!session) return
      }
      const selection = documentSelection(view.state.doc, session, input?.selectionStart ?? session.caret, input?.selectionEnd ?? session.caret, input?.selectionDirection === "backward")
      let transaction = closeHistory(view.state.tr).setMeta(markdownSourceKey, null)
      if (selection) transaction = transaction.setSelection(selection)
      view.dispatch(transaction)
    }
    const begin = (position: number) => {
      if (!editor.isEditable || markdownSourceKey.getState(view.state)) return
      const session = startSession(editor, position)
      if (session) view.dispatch(closeHistory(view.state.tr).setMeta(markdownSourceKey, session))
    }
    const createInput = () => {
      const session = markdownSourceKey.getState(view.state)!
      const wrapper = document.createElement("span")
      wrapper.contentEditable = "false"
      wrapper.dataset.markdownSourceWidget = ""
      wrapper.className = "block w-full"
      const input = document.createElement("textarea")
      input.dataset.markdownSourceInput = ""
      input.setAttribute("aria-label", "当前段落 Markdown 源码")
      input.className = "block w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-inherit outline-none"
      input.style.font = "inherit"
      input.value = session.source
      const resize = () => { input.style.height = "0px"; input.style.height = `${input.scrollHeight}px` }
      const syncSelection = () => {
        const active = markdownSourceKey.getState(view.state)
        if (active?.id !== session.id || input.value !== active.source) return
        const selection = documentSelection(view.state.doc, active, input.selectionStart, input.selectionEnd, input.selectionDirection === "backward")
        const moved = input.selectionStart !== active.caret || input.selectionStart !== input.selectionEnd
        if (selection && (!selection.eq(view.state.selection) || (moved && active.pendingMarks !== undefined))) {
          let transaction = view.state.tr.setSelection(selection).setMeta("addToHistory", false)
          if (moved) transaction = transaction.setMeta(markdownSourceKey, { ...active, caret: input.selectionStart, pendingMarks: undefined })
          view.dispatch(transaction)
        }
        view.dom.dispatchEvent(new Event(MARKDOWN_SOURCE_SELECTION_EVENT))
      }
      const change = () => {
        const current = markdownSourceKey.getState(view.state)
        if (!current || current.id !== session.id) return
        let insertedFrom = 0, insertedTo = 0
        const pending = current.pendingMarks
        if (pending !== undefined) {
          let prefix = 0, suffix = 0
          while (prefix < current.source.length && prefix < input.value.length && current.source[prefix] === input.value[prefix]) prefix++
          while (suffix < current.source.length - prefix && suffix < input.value.length - prefix
            && current.source[current.source.length - suffix - 1] === input.value[input.value.length - suffix - 1]) suffix++
          const inserted = input.value.slice(prefix, input.value.length - suffix)
          if (inserted.trim()) {
            insertedFrom = prefix; insertedTo = prefix + inserted.length
          }
        }
        const selection = { start: input.selectionStart, end: input.selectionEnd }
        const projected = projectSource(editor, current, input.value)
        projected.session.caret = selection.start
        if (pending !== undefined && insertedTo > insertedFrom) {
          const doc = editor.schema.nodeFromJSON(projected.after)
          const range = documentSelection(doc, projected.session, insertedFrom, insertedTo)
          if (range) {
            const transform = new Transform(doc)
            transform.removeMark(range.from, range.to)
            for (const mark of pending) transform.addMark(range.from, range.to, editor.schema.marks[mark.type].create(mark.attrs))
            projected.after = transform.doc.toJSON()
            const source = serializeSource(editor, projected.after, projected.session.paths)
            const rendered = renderedText(transform.doc, projected.session.paths)
            const offset = Math.max(0, rendered.positions.findIndex((position) => position >= range.to))
            const mapping = sourceOffsets(source, rendered.text)
            selection.start = selection.end = Math.max(0, mapping.findIndex((position) => position >= offset))
            input.value = source
            projected.session.source = source
            projected.session.caret = selection.start
          }
          projected.session.pendingMarks = undefined
        }
        updating = true
        try {
          const changed = applyDocumentChange(editor, projected.before, projected.after, crypto.randomUUID(), [], [], {
            historyBoundary: false,
            configureTransaction: (transaction) => transaction.setMeta(markdownSourceKey, projected.session),
          })
          if (!changed) view.dispatch(view.state.tr.setMeta(markdownSourceKey, projected.session))
        } finally { updating = false }
        const mounted = view.dom.querySelector<HTMLTextAreaElement>("[data-markdown-source-input]")
        if (mounted) { mounted.focus({ preventScroll: true }); mounted.setSelectionRange(selection.start, selection.end) }
        syncSelection()
        resize()
      }
      input.addEventListener("input", (event) => { if (!(event as InputEvent).isComposing) change(); else resize() })
      input.addEventListener("compositionend", change)
      input.addEventListener("typedance:commit-markdown-source", change)
      input.addEventListener("select", syncSelection)
      input.addEventListener("keyup", syncSelection)
      input.addEventListener("pointerup", syncSelection)
      input.addEventListener("blur", () => { if (!updating && !disposed && markdownSourceKey.getState(view.state)?.id === session.id) finish() })
      input.addEventListener("keydown", (event) => {
        if ((event.ctrlKey || event.metaKey) && ["b", "i", "u"].includes(event.key.toLowerCase())) {
          event.preventDefault()
          const key = event.key.toLowerCase(), open = key === "b" ? "**" : key === "i" ? "*" : "<u>", close = key === "u" ? "</u>" : open
          const start = input.selectionStart, end = input.selectionEnd
          const active = markdownSourceKey.getState(view.state)
          if (start === end && active) {
            const mark = key === "b" ? "bold" : key === "i" ? "italic" : "underline"
            const marks = active.pendingMarks ?? (editor.state.storedMarks ?? editor.state.selection.$from.marks()).map((value) => value.toJSON())
            const pendingMarks = marks.some((value) => value.type === mark) ? marks.filter((value) => value.type !== mark) : [...marks, { type: mark }]
            view.dispatch(view.state.tr.setStoredMarks(pendingMarks.map((value) => editor.schema.marks[value.type].create(value.attrs)))
              .setMeta(markdownSourceKey, { ...active, pendingMarks }).setMeta("addToHistory", false))
            return
          }
          if (input.value.slice(start - open.length, start) === open && input.value.slice(end, end + close.length) === close) {
            const text = input.value.slice(start, end)
            input.setSelectionRange(start - open.length, end + close.length)
            input.setRangeText(text, input.selectionStart, input.selectionEnd, "select")
          } else {
            input.setRangeText(open + input.value.slice(start, end) + close, start, end, "select")
            input.setSelectionRange(start + open.length, end + open.length)
          }
          change()
        }
        if (event.key === "Escape") { event.preventDefault(); finish(); view.focus() }
        const previous = ["ArrowLeft", "ArrowUp"].includes(event.key) && input.selectionStart === 0
        const next = ["ArrowRight", "ArrowDown"].includes(event.key) && input.selectionEnd === input.value.length
        const active = markdownSourceKey.getState(view.state)
        if (!event.shiftKey && input.selectionStart === input.selectionEnd && active && (previous || next)) {
          const roots = active.paths.map((path) => nodeAtPath(view.state.doc, path))
          const from = roots[0].position
          const last = roots[roots.length - 1]
          const to = last.position + last.node.nodeSize
          let target: number | undefined
          view.state.doc.descendants((node, position) => {
            if (!node.isTextblock) return
            if (previous && position + node.nodeSize <= from) target = position + node.nodeSize - 1
            if (next && target === undefined && position >= to) target = position + 1
          })
          if (target !== undefined) {
            event.preventDefault(); finish()
            view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, target)))
            begin(target)
          }
        }
        if (event.key === "Tab") {
          event.preventDefault()
          input.setRangeText("  ", input.selectionStart, input.selectionEnd, "end")
          change()
        }
      })
      wrapper.append(input)
      queueMicrotask(() => {
        if (disposed || !input.isConnected) return
        const current = markdownSourceKey.getState(view.state)
        const caret = current?.id === session.id ? current.caret : session.caret
        resize(); input.focus({ preventScroll: true }); input.setSelectionRange(caret, caret)
      })
      return wrapper
    }
    return [new Plugin<SourceSession | null>({
      key: markdownSourceKey,
      state: {
        init: () => null,
        apply(transaction, active) {
          const next = transaction.getMeta(markdownSourceKey)
          if (next !== undefined) return next
          if (!transaction.docChanged || !active) return active
          // 末尾空段落等区域外的原生更新可继续编辑；目标内容变化时立即退出，防止覆盖。
          try {
            const before = nodeAtPath(transaction.before, active.parent).node
            const after = nodeAtPath(transaction.doc, active.parent).node
            for (let offset = 0; offset < active.count; offset++) {
              if (!before.child(active.index + offset).eq(after.child(active.index + offset))) return null
            }
            return active
          } catch { return null }
        },
      },
      props: {
        handleClick(_view, position, event) {
          if (event.shiftKey || event.ctrlKey || event.metaKey) return false
          begin(position)
          return Boolean(markdownSourceKey.getState(view.state))
        },
        handleTextInput(_view, from, to, text) {
          if (from !== to || !editor.isEditable) return false
          begin(from)
          const input = view.dom.querySelector<HTMLTextAreaElement>("[data-markdown-source-input]")
          const active = markdownSourceKey.getState(view.state)
          if (!input || !active) return false
          input.setSelectionRange(active.caret, active.caret)
          input.setRangeText(text, input.selectionStart, input.selectionEnd, "end")
          input.dispatchEvent(new Event("input", { bubbles: true }))
          return true
        },
        handleKeyDown(_view, event) {
          if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key) && !event.shiftKey) queueMicrotask(() => {
            if (!disposed && view.hasFocus() && view.state.selection.empty) begin(view.state.selection.from)
          })
          return false
        },
        decorations(state) {
          const active = markdownSourceKey.getState(state)
          if (!active) return null
          const decorations: Decoration[] = []
          const roots = active.paths.map((path) => nodeAtPath(state.doc, path))
          const first = roots.map(({ node, position }) => firstTextblock(node, position)).find(Boolean)
          const hide = (node: ProseMirrorNode, position: number) => {
            if (first && position === first.position) {
              if (node.content.size) decorations.push(Decoration.inline(position + 1, position + node.nodeSize - 1, { "data-markdown-source-hidden": "" }))
              decorations.push(Decoration.node(position, position + node.nodeSize, { "data-markdown-source-active": "" }))
            } else if (first && position < first.position && position + node.nodeSize > first.position) {
              if (node.type.name === "listItem") decorations.push(Decoration.node(position, position + node.nodeSize, { "data-markdown-source-list": "" }))
              node.forEach((child, offset) => hide(child, position + 1 + offset))
            } else decorations.push(Decoration.node(position, position + node.nodeSize, { "data-markdown-source-hidden": "" }))
          }
          roots.forEach(({ node, position }) => hide(node, position))
          decorations.push(Decoration.widget(first ? first.position + 1 : roots[0].position, createInput, { key: active.id, side: -1, stopEvent: () => true, ignoreSelection: true }))
          return DecorationSet.create(state.doc, decorations)
        },
      },
      view(editorView) {
        view = editorView
        const outside = (event: PointerEvent) => {
          if (event.target instanceof Element && !event.target.closest("[data-markdown-source-widget]")) finish()
        }
        document.addEventListener("pointerdown", outside, true)
        view.dom.addEventListener("typedance:render-markdown", finish)
        return {
          update() {
            const input = view.dom.querySelector<HTMLTextAreaElement>("[data-markdown-source-input]")
            if (input) input.readOnly = !editor.isEditable
          },
          destroy() { disposed = true; document.removeEventListener("pointerdown", outside, true); view.dom.removeEventListener("typedance:render-markdown", finish) },
        }
      },
    })]
  },
})
