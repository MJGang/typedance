export type PersistedModuleOutlinePreferences = {
  visible: boolean
  expanded: boolean
  position: { x: number; y: number }
}

type Position = { x: number; y: number }
type Size = { width: number; height: number }

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
  if (!isModuleOutlinePreferences(preferences)) return

  const persistedPreferences: PersistedModuleOutlinePreferences = {
    visible: preferences.visible,
    expanded: preferences.expanded,
    position: {
      x: preferences.position.x,
      y: preferences.position.y,
    },
  }

  try {
    localStorage.setItem(moduleOutlineStorageKey(documentId), JSON.stringify(persistedPreferences))
  } catch {
    // Preference persistence is best-effort when browser storage is unavailable.
  }
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
