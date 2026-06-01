import type { ModuleAnchor } from "@typedance/contracts"

export type ModuleVisualRegion = {
  moduleId: string
  pageIndex: number
  top: number
  left: number
  width: number
  height: number
}

export type PersistedModuleOutlinePreferences = {
  visible: boolean
  expanded: boolean
  position: { x: number; y: number }
}

export type ModuleLayoutRect = {
  top: number
  bottom: number
  left: number
  right: number
}

type Position = { x: number; y: number }
type Size = { width: number; height: number }
type PaginationGap = { top: number; bottom: number }
type ModuleLayoutNode = { canvasNodeId: string; rect: ModuleLayoutRect }

const MODULE_OUTLINE_STORAGE_PREFIX = "typedance:revision-workspace:module-outline:"

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function isModuleOutlinePreferences(value: unknown): value is PersistedModuleOutlinePreferences {
  if (typeof value !== "object" || value === null) return false

  const preferences = value as Record<string, unknown>
  const position = preferences.position
  if (typeof position !== "object" || position === null) return false

  const coordinates = position as Record<string, unknown>
  return (
    typeof preferences.visible === "boolean"
    && typeof preferences.expanded === "boolean"
    && isFiniteNumber(coordinates.x)
    && isFiniteNumber(coordinates.y)
  )
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function finiteCoordinate(value: number): number {
  return Number.isFinite(value) ? value : 0
}

export function moduleOutlineStorageKey(documentId: string): string {
  return `${MODULE_OUTLINE_STORAGE_PREFIX}${documentId}`
}

export function loadModuleOutlinePreferences(
  documentId: string,
): PersistedModuleOutlinePreferences | null {
  try {
    const storedValue = localStorage.getItem(moduleOutlineStorageKey(documentId))
    if (storedValue === null) return null

    const preferences: unknown = JSON.parse(storedValue)
    if (!isModuleOutlinePreferences(preferences)) return null

    return {
      visible: preferences.visible,
      expanded: preferences.expanded,
      position: {
        x: preferences.position.x,
        y: preferences.position.y,
      },
    }
  } catch {
    return null
  }
}

export function saveModuleOutlinePreferences(
  documentId: string,
  preferences: PersistedModuleOutlinePreferences,
): void {
  const persistedPreferences: PersistedModuleOutlinePreferences = {
    visible: preferences.visible,
    expanded: preferences.expanded,
    position: {
      x: preferences.position.x,
      y: preferences.position.y,
    },
  }

  localStorage.setItem(moduleOutlineStorageKey(documentId), JSON.stringify(persistedPreferences))
}

export function clampOutlinePosition(
  position: Position,
  viewportSize: Size,
  outlineSize: Size,
): Position {
  const maxX = Math.max(0, finiteNonNegative(viewportSize.width) - finiteNonNegative(outlineSize.width))
  const maxY = Math.max(0, finiteNonNegative(viewportSize.height) - finiteNonNegative(outlineSize.height))

  return {
    x: Math.min(Math.max(0, finiteCoordinate(position.x)), maxX),
    y: Math.min(Math.max(0, finiteCoordinate(position.y)), maxY),
  }
}

export function getDefaultModuleOutlinePosition(
  viewportSize: Size,
  outlineSize: Size,
): Position {
  return clampOutlinePosition(
    {
      x: finiteNonNegative(viewportSize.width) - finiteNonNegative(outlineSize.width) - 12,
      y: 48,
    },
    viewportSize,
    outlineSize,
  )
}

function splitRectAcrossGaps(
  rect: ModuleLayoutRect,
  gaps: PaginationGap[],
): Array<{ pageIndex: number; top: number; bottom: number }> {
  const fragments: Array<{ pageIndex: number; top: number; bottom: number }> = []
  let fragmentTop = rect.top
  let pageIndex = 0

  for (const gap of gaps) {
    if (rect.bottom <= gap.top) break
    if (fragmentTop >= gap.bottom) {
      pageIndex += 1
      continue
    }

    if (fragmentTop < gap.top) {
      fragments.push({
        pageIndex,
        top: fragmentTop,
        bottom: Math.min(rect.bottom, gap.top),
      })
    }

    fragmentTop = Math.max(fragmentTop, gap.bottom)
    pageIndex += 1
    if (fragmentTop >= rect.bottom) break
  }

  if (fragmentTop < rect.bottom) {
    fragments.push({ pageIndex, top: fragmentTop, bottom: rect.bottom })
  }

  return fragments
}

export function buildModuleVisualRegions({
  anchors,
  nodes,
  gaps,
}: {
  anchors: ModuleAnchor[]
  nodes: ModuleLayoutNode[]
  gaps: PaginationGap[]
}): ModuleVisualRegion[] {
  const sortedAnchors = anchors
    .map((anchor, inputIndex) => ({ anchor, inputIndex }))
    .sort((left, right) => left.anchor.order - right.anchor.order || left.inputIndex - right.inputIndex)
  const sortedGaps = gaps
    .map((gap) => ({ ...gap }))
    .sort((left, right) => left.top - right.top || left.bottom - right.bottom)
  const rectsByNodeId = new Map(nodes.map((node) => [node.canvasNodeId, node.rect]))
  const moduleOrder = new Map<string, number>()
  const regions = new Map<string, ModuleVisualRegion>()

  for (const [anchorIndex, { anchor }] of sortedAnchors.entries()) {
    if (!moduleOrder.has(anchor.module_id)) moduleOrder.set(anchor.module_id, anchorIndex)

    for (const canvasNodeId of anchor.canvas_node_ids) {
      const rect = rectsByNodeId.get(canvasNodeId)
      if (!rect) continue

      for (const fragment of splitRectAcrossGaps(rect, sortedGaps)) {
        const key = `${anchor.module_id}\u0000${fragment.pageIndex}`
        const existingRegion = regions.get(key)
        if (!existingRegion) {
          regions.set(key, {
            moduleId: anchor.module_id,
            pageIndex: fragment.pageIndex,
            top: fragment.top,
            left: rect.left,
            width: rect.right - rect.left,
            height: fragment.bottom - fragment.top,
          })
          continue
        }

        const right = Math.max(existingRegion.left + existingRegion.width, rect.right)
        const bottom = Math.max(existingRegion.top + existingRegion.height, fragment.bottom)
        existingRegion.top = Math.min(existingRegion.top, fragment.top)
        existingRegion.left = Math.min(existingRegion.left, rect.left)
        existingRegion.width = right - existingRegion.left
        existingRegion.height = bottom - existingRegion.top
      }
    }
  }

  return [...regions.values()].sort((left, right) => (
    (moduleOrder.get(left.moduleId) ?? 0) - (moduleOrder.get(right.moduleId) ?? 0)
    || left.pageIndex - right.pageIndex
  ))
}
