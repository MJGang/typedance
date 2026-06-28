export type PanelWidths = {
  left: number
  right: number
}

export const PANEL_WIDTH_STORAGE_KEY = "typedance.revision-workspace.panel-widths.v1"
export const DEFAULT_PANEL_WIDTHS: PanelWidths = { left: 272, right: 384 }
export const LEFT_PANEL_MIN_WIDTH = 220
export const LEFT_PANEL_MAX_WIDTH = 420
export const RIGHT_PANEL_MIN_WIDTH = 320
export const RIGHT_PANEL_MAX_WIDTH = 560
export const DRAFT_PANEL_MIN_WIDTH = 640

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function isValidPanelWidths(value: unknown): value is PanelWidths {
  if (!value || typeof value !== "object") return false
  const widths = value as Partial<PanelWidths>
  return (
    typeof widths.left === "number"
    && Number.isFinite(widths.left)
    && widths.left >= LEFT_PANEL_MIN_WIDTH
    && widths.left <= LEFT_PANEL_MAX_WIDTH
    && typeof widths.right === "number"
    && Number.isFinite(widths.right)
    && widths.right >= RIGHT_PANEL_MIN_WIDTH
    && widths.right <= RIGHT_PANEL_MAX_WIDTH
  )
}

export function loadPanelWidths(): PanelWidths {
  try {
    const raw = window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY)
    if (!raw) return DEFAULT_PANEL_WIDTHS
    const parsed: unknown = JSON.parse(raw)
    return isValidPanelWidths(parsed) ? parsed : DEFAULT_PANEL_WIDTHS
  } catch {
    return DEFAULT_PANEL_WIDTHS
  }
}

export function savePanelWidths(widths: PanelWidths) {
  try {
    window.localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, JSON.stringify(widths))
  } catch {
    // Width persistence is optional; the current session remains usable.
  }
}

export function resolvePanelLayout({
  containerWidth,
  leftVisible,
  rightVisible,
  requested,
}: {
  containerWidth: number
  leftVisible: boolean
  rightVisible: boolean
  requested: PanelWidths
}) {
  let left = leftVisible ? clamp(requested.left, LEFT_PANEL_MIN_WIDTH, LEFT_PANEL_MAX_WIDTH) : 0
  let right = rightVisible ? clamp(requested.right, RIGHT_PANEL_MIN_WIDTH, RIGHT_PANEL_MAX_WIDTH) : 0

  if (containerWidth > 0) {
    let overflow = Math.max(0, left + right + DRAFT_PANEL_MIN_WIDTH - containerWidth)
    const rightReduction = Math.min(overflow, Math.max(0, right - RIGHT_PANEL_MIN_WIDTH))
    right -= rightReduction
    overflow -= rightReduction
    const leftReduction = Math.min(overflow, Math.max(0, left - LEFT_PANEL_MIN_WIDTH))
    left -= leftReduction
  }

  return {
    left,
    right,
    leftMax: leftVisible
      ? Math.max(
          LEFT_PANEL_MIN_WIDTH,
          Math.min(
            LEFT_PANEL_MAX_WIDTH,
            containerWidth > 0
              ? containerWidth - right - DRAFT_PANEL_MIN_WIDTH
              : LEFT_PANEL_MAX_WIDTH,
          ),
        )
      : 0,
    rightMax: rightVisible
      ? Math.max(
          RIGHT_PANEL_MIN_WIDTH,
          Math.min(
            RIGHT_PANEL_MAX_WIDTH,
            containerWidth > 0
              ? containerWidth - left - DRAFT_PANEL_MIN_WIDTH
              : RIGHT_PANEL_MAX_WIDTH,
          ),
        )
      : 0,
  }
}
