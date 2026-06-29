type Size = { width: number; height: number }

const MODULE_OUTLINE_MIN_WIDTH = 224
const MODULE_OUTLINE_MAX_WIDTH = 288
const MODULE_OUTLINE_WIDTH_RATIO = 0.22
const MODULE_OUTLINE_PAGE_GAP = 24
const MODULE_OUTLINE_RIGHT_SAFE_GAP = 24

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
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
