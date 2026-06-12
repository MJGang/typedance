export type PersistedModuleOutlinePreferences = {
  visible: boolean
  expanded: boolean
}

type Size = { width: number; height: number }

const MODULE_OUTLINE_STORAGE_PREFIX = "typedance:revision-workspace:module-outline:"
const MODULE_OUTLINE_MIN_WIDTH = 224
const MODULE_OUTLINE_MAX_WIDTH = 288
const MODULE_OUTLINE_WIDTH_RATIO = 0.22
const MODULE_OUTLINE_PAGE_GAP = 24
const MODULE_OUTLINE_RIGHT_SAFE_GAP = 24

function isModuleOutlinePreferences(value: unknown): value is PersistedModuleOutlinePreferences {
  if (typeof value !== "object" || value === null) return false

  const preferences = value as Record<string, unknown>
  return (
    typeof preferences.visible === "boolean"
    && typeof preferences.expanded === "boolean"
  )
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
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
  }

  try {
    localStorage.setItem(moduleOutlineStorageKey(documentId), JSON.stringify(persistedPreferences))
  } catch {
    // Preference persistence is best-effort when browser storage is unavailable.
  }
}

export function clampModuleOutlinePanelWidth(viewportSize: Size): number {
  const preferredWidth = finiteNonNegative(viewportSize.width) * MODULE_OUTLINE_WIDTH_RATIO
  return Math.min(
    MODULE_OUTLINE_MAX_WIDTH,
    Math.max(MODULE_OUTLINE_MIN_WIDTH, preferredWidth),
  )
}

export function canDockModuleOutline(
  viewportSize: Size,
  pageWidth: number,
): boolean {
  const minRequiredWidth = finiteNonNegative(pageWidth)
    + MODULE_OUTLINE_MIN_WIDTH
    + MODULE_OUTLINE_PAGE_GAP
    + MODULE_OUTLINE_RIGHT_SAFE_GAP
  return finiteNonNegative(viewportSize.width) >= minRequiredWidth
}

export function getModuleOutlineLayout(
  viewportSize: Size,
  pageWidth: number,
) {
  const panelWidth = clampModuleOutlinePanelWidth(viewportSize)
  const docked = canDockModuleOutline(viewportSize, pageWidth)

  return {
    docked,
    panelWidth,
    reservedWidth: docked ? panelWidth + MODULE_OUTLINE_PAGE_GAP : 0,
  }
}
