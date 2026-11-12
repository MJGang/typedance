import type { EditorView } from "@tiptap/pm/view"
import type { getEditorPreviewChanges } from "./editorPreviewChanges"

export type PreviewRect = { left: number; top: number; width: number; height: number }
export type PreviewInk = PreviewRect & { key: string; original: string; font: string; color: string }

type Bounds = { left: number; right: number; top: number; bottom: number }

function pageBands(editor: HTMLElement, bounds: Bounds): Bounds[] {
  const bands: Bounds[] = []
  const { left, right, bottom } = bounds
  let top = bounds.top
  // The breaker includes the page footer, the visual gap and the next header.
  for (const breaker of editor.querySelectorAll(".rm-page-break > .breaker")) {
    const gap = breaker.getBoundingClientRect()
    if (gap.height <= 0 || gap.bottom <= top || gap.top >= bounds.bottom) continue
    if (gap.top > top) bands.push({ left, right, top, bottom: gap.top })
    top = gap.bottom
  }
  if (top < bottom) bands.push({ left, right, top, bottom })
  return bands
}

function intersect(left: Bounds, right: Bounds): Bounds | undefined {
  const rect = {
    left: Math.max(left.left, right.left), top: Math.max(left.top, right.top),
    right: Math.min(left.right, right.right), bottom: Math.min(left.bottom, right.bottom),
  }
  return rect.right > rect.left && rect.bottom > rect.top ? rect : undefined
}

function union(rects: Bounds[]): Bounds | undefined {
  return rects.reduce<Bounds | undefined>((result, rect) => result ? {
    left: Math.min(result.left, rect.left), top: Math.min(result.top, rect.top),
    right: Math.max(result.right, rect.right), bottom: Math.max(result.bottom, rect.bottom),
  } : rect, undefined)
}

export function measureEditorPreview(view: EditorView, layerParent: HTMLElement, changes: ReturnType<typeof getEditorPreviewChanges>) {
  const root = layerParent.getBoundingClientRect()
  const editor = view.dom.getBoundingClientRect()
  const scaleX = root.width / layerParent.offsetWidth || 1
  const scaleY = root.height / layerParent.offsetHeight || scaleX
  const bands = pageBands(view.dom, editor)
  const local = (rect: Bounds): PreviewRect => ({
    left: (rect.left - root.left) / scaleX, top: (rect.top - root.top) / scaleY,
    width: (rect.right - rect.left) / scaleX, height: (rect.bottom - rect.top) / scaleY,
  })
  const cards: (PreviewRect & { key: string })[] = []
  for (const [index, band] of bands.entries()) {
    if (changes.pageLayout) {
      cards.push({ ...local(band), key: `page-${index}` })
      continue
    }
    for (const [groupIndex, region] of changes.groups.entries()) {
      const rects = region.positions.flatMap(position => {
        const node = view.nodeDOM(position)
        if (!(node instanceof HTMLElement) || node.hasAttribute("data-rm-pagination-ignore")) return []
        const rect = node.getBoundingClientRect()
        if (!rect.width) return []
        if (region.edge) {
          const line = region.edge === "before" ? rect.top : rect.bottom
          return [{ left: rect.left, right: rect.right, top: line - 2 * scaleY, bottom: line + 2 * scaleY }]
        }
        return [rect]
      })
      const clipped = rects.flatMap(rect => {
        const overlap = intersect(rect, band)
        return overlap ? [overlap] : []
      })
      const area = union(clipped)
      if (!area) continue
      const padded = intersect({
        left: area.left - 4 * scaleX, right: area.right + 4 * scaleX,
        top: area.top - 3 * scaleY, bottom: area.bottom + 3 * scaleY,
      }, band)
      if (padded) cards.push({ ...local(padded), key: `${groupIndex}-${index}` })
    }
  }

  const ink: PreviewInk[] = []
  for (const change of changes.text) {
    if (!change.original || change.original.length > 120 || change.from === change.to || ink.length >= 16) continue
    const from = view.domAtPos(change.from, 1)
    const to = view.domAtPos(change.to, -1)
    const text = document.createRange()
    text.setStart(from.node, from.offset)
    text.setEnd(to.node, to.offset)
    const rects = Array.from(text.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0)
    const total = rects.reduce((width, rect) => width + rect.width, 0)
    const characters = Array.from(change.original)
    const style = getComputedStyle(from.node instanceof HTMLElement ? from.node : from.node.parentElement ?? view.dom)
    let width = 0
    let start = 0
    for (const [index, rect] of rects.entries()) {
      width += rect.width
      const end = Math.round(width / total * characters.length)
      const fragment = characters.slice(start, end).join("")
      start = end
      const band = bands.find(page => rect.top >= page.top && rect.top < page.bottom)
      const clipped = band && intersect(rect, band)
      if (!fragment || !clipped) continue
      ink.push({
        ...local(clipped), key: `${change.from}-${index}`, original: fragment,
        font: `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`, color: style.color,
      })
      if (ink.length >= 16) break
    }
  }
  return { cards, ink }
}
