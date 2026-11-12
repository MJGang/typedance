import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import type { EditorTransaction } from "@typedance/contracts"
import { diffChars } from "diff"

type Block = {
  index: number
  position: number
  node: ProseMirrorNode
  parent: Block | null
}

export type PreviewRegion = {
  positions: number[]
  edge?: "before" | "after"
}

export type PreviewTextChange = { from: number; to: number; original: string }

function indexBlocks(doc: ProseMirrorNode) {
  const blocks = new Map<string, Block>()
  const visit = (node: ProseMirrorNode, position: number, key: string, index: number, parent: Block | null) => {
    const block = { index, position, node, parent }
    blocks.set(key, block)
    node.forEach((child, offset, childIndex) => {
      if (!child.isInline) visit(child, position + 1 + offset, key ? `${key}.${childIndex}` : String(childIndex), childIndex, block)
    })
  }
  visit(doc, -1, "", 0, null)
  return blocks
}

function enclosingColumns(block: Block): Block {
  for (let current: Block | null = block; current?.parent; current = current.parent) {
    if (current.node.type.name === "columns") return current
  }
  return block
}

function changedText(before: Block, after: Block): PreviewTextChange[] {
  if (!before.node.isTextblock || !after.node.isTextblock) return []
  const oldText = before.node.textBetween(0, before.node.content.size, "\n", "\n")
  const newText = after.node.textBetween(0, after.node.content.size, "\n", "\n")
  if (oldText === newText || oldText.length + newText.length > 12000) return []
  const changes = diffChars(oldText, newText, { timeout: 35 })
  const result: PreviewTextChange[] = []
  let offset = after.position + 1
  let pending: PreviewTextChange | undefined
  for (const change of changes ?? []) {
    if (!change.added && !change.removed) {
      if (pending) result.push(pending)
      pending = undefined
      offset += change.value.length
      continue
    }
    pending ??= { from: offset, to: offset, original: "" }
    if (change.removed) pending.original += change.value
    else {
      offset += change.value.length
      pending.to = offset
    }
  }
  if (pending) result.push(pending)
  return result
}

function sameBlockMarkup(before: ProseMirrorNode, after: ProseMirrorNode) {
  if (before.type !== after.type) return false
  return Object.keys(after.attrs).every(key => key === "canvasNodeId" || key === "sourceBlockId"
    || JSON.stringify(before.attrs[key]) === JSON.stringify(after.attrs[key]))
}

/** Compare only matched siblings when determining order changes. Insertions and
 * removals change path indices without reordering surviving content. */
export function getEditorPreviewChanges(beforeDoc: ProseMirrorNode, afterDoc: ProseMirrorNode, origins: EditorTransaction["node_origins"]) {
  if (beforeDoc.eq(afterDoc)) return { groups: [], text: [], pageLayout: false }
  const before = indexBlocks(beforeDoc)
  const after = indexBlocks(afterDoc)
  const forward = new Map<Block, Block>()
  const backward = new Map<Block, Block>()
  forward.set(before.get("")!, after.get("")!)
  for (const origin of origins) {
    if (origin.after_path === null) continue
    const previous = before.get(origin.before_path.join("."))
    const current = after.get(origin.after_path.join("."))
    if (previous && current) {
      forward.set(previous, current)
      backward.set(current, previous)
    }
  }

  const selected = new Set<Block>()
  const moved = new Set<Block>()
  const siblings = new Map<Block, Block[]>()
  const text: PreviewTextChange[] = []
  for (const current of after.values()) {
    if (!current.parent) continue
    const previous = backward.get(current)
    if (!previous) {
      selected.add(enclosingColumns(current))
      continue
    }
    const sameParent = previous.parent && forward.get(previous.parent) === current.parent
    if (!sameParent) selected.add(enclosingColumns(current))
    else {
      const peers = siblings.get(current.parent) ?? []
      peers.push(current)
      siblings.set(current.parent, peers)
    }
    if (!sameBlockMarkup(previous.node, current.node) || (current.node.isTextblock && !previous.node.content.eq(current.node.content))) {
      selected.add(enclosingColumns(current))
      text.push(...changedText(previous, current))
    }
  }
  for (const peers of siblings.values()) {
    const originalOrder = [...peers].sort((a, b) => backward.get(a)!.index - backward.get(b)!.index)
    peers.forEach((block, index) => {
      if (originalOrder[index] === block) return
      const target = enclosingColumns(block)
      moved.add(target)
      selected.add(target)
    })
  }

  const groups: PreviewRegion[] = []
  let last: Block | undefined
  for (const block of [...selected].sort((a, b) => a.position - b.position)) {
    let covered = false
    for (let parent = block.parent; parent; parent = parent.parent) {
      if (selected.has(parent)) { covered = true; break }
    }
    if (covered) continue
    if (last && moved.has(last) && moved.has(block) && last.parent === block.parent && last.index + 1 === block.index) {
      groups[groups.length - 1].positions.push(block.position)
    } else groups.push({ positions: [block.position] })
    last = block
  }

  const beforeChildren = new Map<Block, Block[]>()
  const survivingAncestors = new Set<Block>()
  for (const block of before.values()) {
    if (block.parent) {
      const children = beforeChildren.get(block.parent) ?? []
      children.push(block)
      beforeChildren.set(block.parent, children)
    }
    if (forward.has(block)) {
      for (let parent = block.parent; parent && !survivingAncestors.has(parent); parent = parent.parent) survivingAncestors.add(parent)
    }
  }
  const markedEdges = new Set<string>()
  for (const block of before.values()) {
    if (!block.parent || forward.has(block) || !forward.has(block.parent) || survivingAncestors.has(block)) continue
    const siblings = beforeChildren.get(block.parent)!
    const next = siblings.slice(block.index + 1).map(sibling => forward.get(sibling)).find(sibling => sibling?.parent === forward.get(block.parent!))
    const previous = siblings.slice(0, block.index).reverse().map(sibling => forward.get(sibling)).find(sibling => sibling?.parent === forward.get(block.parent!))
    const neighbor = next ?? previous ?? forward.get(block.parent)
    if (!neighbor || neighbor.position < 0) continue
    const column = enclosingColumns(neighbor)
    const edge = next ? "before" : "after"
    const key = `${column.position}:${column === neighbor ? edge : "row"}`
    if (markedEdges.has(key)) continue
    markedEdges.add(key)
    if (column !== neighbor && selected.has(column)) continue
    groups.push({ positions: [column.position], ...(column === neighbor ? { edge } : {}) })
  }

  const pageLayout = !sameBlockMarkup(beforeDoc, afterDoc)
  return { groups, text, pageLayout }
}
