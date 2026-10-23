import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import type { Transaction } from "@tiptap/pm/state"
import type { EditorNodeOrigin, EditorTextOrigin } from "@typedance/contracts"
import type { CanvasReferenceSource } from "./EditorReferences"

const originKey = "typedance-document-origins"
type NodeOrigin = { from: number; to: number; afterFrom: number | null; afterTo: number | null; unchanged: boolean }
type TextSpan = { from: number; to: number; afterFrom: number }
type TextBlock = { from: number; to: number; spans: TextSpan[] }
type Origins = { nodes: NodeOrigin[]; blocks: TextBlock[] }

function nodePosition(doc: ProseMirrorNode, path: number[]) {
  let node = doc, position = -1
  for (const index of path) {
    if (index < 0 || index >= node.childCount) throw new Error("来源节点路径无效")
    position++
    for (let sibling = 0; sibling < index; sibling++) position += node.child(sibling).nodeSize
    node = node.child(index)
  }
  return { node, position }
}

/** 来源由业务执行器生成；这里仅校验并换算原生编辑器的位置。 */
export function setReferenceOrigins(transaction: Transaction, nodes: EditorNodeOrigin[], text: EditorTextOrigin[]): void {
  const anchors = nodes.map((entry): NodeOrigin => {
    const before = nodePosition(transaction.before, entry.before_path)
    if (entry.after_path === null) return { from: before.position, to: before.position + before.node.nodeSize, afterFrom: null, afterTo: null, unchanged: false }
    const after = nodePosition(transaction.doc, entry.after_path)
    return { from: before.position, to: before.position + before.node.nodeSize, afterFrom: after.position,
      afterTo: after.position + after.node.nodeSize, unchanged: before.node.content.eq(after.node.content) }
  })
  anchors.sort((left, right) => (left.to - left.from) - (right.to - right.from))
  const blocks = text.map((entry): TextBlock => {
    const before = nodePosition(transaction.before, entry.before_path)
    if (!before.node.isTextblock) throw new Error("原文来源必须指向文字块")
    const spans = entry.spans.map((span): TextSpan => {
      const after = nodePosition(transaction.doc, span.after_path)
      const length = span.before_to - span.before_from
      if (!after.node.isTextblock || length <= 0 || span.before_from < 0 || span.before_to > before.node.content.size
        || span.after_from < 0 || span.after_from + length > after.node.content.size
        || before.node.textBetween(span.before_from, span.before_to, "\n", "\n") !== after.node.textBetween(span.after_from, span.after_from + length, "\n", "\n")) {
        throw new Error("原文来源与编辑结果不一致")
      }
      return { from: before.position + 1 + span.before_from, to: before.position + 1 + span.before_to, afterFrom: after.position + 1 + span.after_from }
    }).sort((left, right) => left.from - right.from)
    return { from: before.position + 1, to: before.position + 1 + before.node.content.size, spans }
  })
  transaction.setMeta(originKey, { nodes: anchors, blocks } satisfies Origins)
}

function mapText(transaction: Transaction, source: CanvasReferenceSource, blocks: TextBlock[], native: CanvasReferenceSource) {
  if (!blocks.length || source.from < 0 || source.to > transaction.before.content.size || source.from >= source.to) return
  const glyphs: Array<{ from: number; to: number; block: TextBlock }> = []
  let supported = true
  transaction.before.nodesBetween(source.from, source.to, (node, position) => {
    if (!node.isText && node.type.name !== "hardBreak") { if (node.isLeaf) supported = false; return }
    const from = Math.max(position, source.from), to = Math.min(position + node.nodeSize, source.to)
    if (from >= to) return
    const block = blocks.find((entry) => from >= entry.from && to <= entry.to)
    if (block) glyphs.push({ from, to, block })
    else supported = false
  })
  if (!supported || !glyphs.length) return
  const mapped: Array<{ from: number; to: number }> = []
  for (const glyph of glyphs) {
    let cursor = glyph.from
    for (const span of glyph.block.spans) {
      const from = Math.max(span.from, glyph.from), to = Math.min(span.to, glyph.to)
      if (from >= to) continue
      if (from !== cursor) return { source: native, changed: true }
      const afterFrom = span.afterFrom + from - span.from
      if (mapped.length && afterFrom < mapped[mapped.length - 1].to) return { source: native, changed: true }
      mapped.push({ from: afterFrom, to: span.afterFrom + to - span.from })
      cursor = to
    }
    if (cursor !== glyph.to) return { source: native, changed: true }
  }
  // 结构边界保留相对长度；最终准确切片校验会拒绝改变了引用结构的结果。
  return { source: { ...native, from: mapped[0].from - (glyphs[0].from - source.from),
    to: mapped[mapped.length - 1].to + source.to - glyphs[glyphs.length - 1].to }, changed: false }
}

export function mapReferenceOrigin(transaction: Transaction, source: CanvasReferenceSource, native: CanvasReferenceSource, fromDeleted: boolean, toDeleted: boolean) {
  const origins = transaction.getMeta(originKey) as Origins | undefined
  if (!origins) return
  const text = mapText(transaction, source, origins.blocks, native)
  if (text) return text
  const start = origins.nodes.find((entry) => source.from >= entry.from && source.from < entry.to)
  const end = origins.nodes.find((entry) => source.to > entry.from && source.to <= entry.to)
  if (!start || !end) return
  if (start.afterFrom === null || start.afterTo === null || end.afterFrom === null || end.afterTo === null) return { source: native, changed: true }
  const mapped = { ...native,
    from: start.unchanged ? source.from + start.afterFrom - start.from : native.from,
    to: end.unchanged ? source.to + end.afterFrom - end.from : native.to }
  return { source: mapped, changed: (!start.unchanged && fromDeleted) || (!end.unchanged && toDeleted)
    || mapped.from < start.afterFrom || mapped.from >= start.afterTo || mapped.to <= end.afterFrom || mapped.to > end.afterTo }
}
