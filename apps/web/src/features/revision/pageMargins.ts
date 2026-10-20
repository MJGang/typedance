import { PAGE_SIZES } from "tiptap-pagination-plus"

export const SOURCE_CANVAS_PAGE_SIZE = {
  width: PAGE_SIZES.A4.pageWidth,
  height: PAGE_SIZES.A4.pageHeight,
}

export type PageMargins = {
  top: number
  bottom: number
  left: number
  right: number
}

export type PageSize = {
  width: number
  height: number
}

const PAGE_MARGIN_STORAGE_PREFIX = "typedance:revision-workspace:page-margins:"
const MIN_CONTENT_WIDTH = 240
const MIN_CONTENT_HEIGHT = 240

export const DEFAULT_SOURCE_CANVAS_PAGE_MARGINS: PageMargins = {
  top: 76,
  bottom: 76,
  left: 50,
  right: 50,
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function isPageMargins(value: unknown): value is PageMargins {
  if (typeof value !== "object" || value === null) return false

  const margins = value as Record<string, unknown>
  return (
    isFiniteNumber(margins.top)
    && isFiniteNumber(margins.bottom)
    && isFiniteNumber(margins.left)
    && isFiniteNumber(margins.right)
  )
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

export function pageMarginStorageKey(documentId: string): string {
  return `${PAGE_MARGIN_STORAGE_PREFIX}${documentId}`
}

export function clampPageMargins(margins: PageMargins, pageSize: PageSize): PageMargins {
  const width = finiteNonNegative(pageSize.width)
  const height = finiteNonNegative(pageSize.height)
  const maxHorizontalTotal = Math.max(0, width - MIN_CONTENT_WIDTH)
  const maxVerticalTotal = Math.max(0, height - MIN_CONTENT_HEIGHT)
  const left = Math.min(Math.round(finiteNonNegative(margins.left)), maxHorizontalTotal)
  const right = Math.min(
    Math.round(finiteNonNegative(margins.right)),
    Math.max(0, maxHorizontalTotal - left),
  )
  const top = Math.min(Math.round(finiteNonNegative(margins.top)), maxVerticalTotal)
  const bottom = Math.min(
    Math.round(finiteNonNegative(margins.bottom)),
    Math.max(0, maxVerticalTotal - top),
  )

  return { top, bottom, left, right }
}

export function loadPageMarginPreferences(
  documentId: string,
  pageSize: PageSize,
): PageMargins | null {
  try {
    const storedValue = localStorage.getItem(pageMarginStorageKey(documentId))
    if (storedValue === null) return null

    const margins: unknown = JSON.parse(storedValue)
    if (!isPageMargins(margins)) return null

    return clampPageMargins(margins, pageSize)
  } catch {
    return null
  }
}

export function savePageMarginPreferences(
  documentId: string,
  margins: PageMargins,
  pageSize: PageSize,
): void {
  const persistedMargins = clampPageMargins(margins, pageSize)

  try {
    localStorage.setItem(pageMarginStorageKey(documentId), JSON.stringify(persistedMargins))
  } catch {
    // Page margin preferences are local UI state and remain best-effort.
  }
}

export function copyPageMarginPreferences(sourceDocumentId: string, targetDocumentId: string): void {
  const margins = loadPageMarginPreferences(sourceDocumentId, SOURCE_CANVAS_PAGE_SIZE)
  if (margins) savePageMarginPreferences(targetDocumentId, margins, SOURCE_CANVAS_PAGE_SIZE)
}
