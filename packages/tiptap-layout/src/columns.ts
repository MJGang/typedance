import { mergeAttributes, Node } from "@tiptap/core"

export type ColumnsCount = 2 | 3 | 4 | 5 | 6
export type ColumnsGap = "compact" | "default" | "wide"
export type ColumnWidths = number[]

const COLUMN_WIDTH_PRECISION = 4
export const MIN_COLUMN_WIDTH_PERCENT = 15

function roundColumnWidth(value: number) {
  return Number(value.toFixed(COLUMN_WIDTH_PRECISION))
}

export function equalColumnWidths(count: ColumnsCount): ColumnWidths {
  const width = Math.floor((100 / count) * 10 ** COLUMN_WIDTH_PRECISION) / 10 ** COLUMN_WIDTH_PRECISION
  const widths = Array.from({ length: count }, () => width)
  widths[count - 1] = roundColumnWidth(100 - width * (count - 1))
  return widths as ColumnWidths
}

export function normalizeColumnWidths(value: unknown, count: ColumnsCount): ColumnWidths {
  if (!Array.isArray(value) || value.length !== count) {
    return equalColumnWidths(count)
  }

  const rawWidths = value.map(Number)
  if (rawWidths.some((width) => !Number.isFinite(width) || width <= 0)) {
    return equalColumnWidths(count)
  }

  const total = rawWidths.reduce((sum, width) => sum + width, 0)
  const normalized = rawWidths.map((width) => roundColumnWidth(width / total * 100))
  normalized[count - 1] = roundColumnWidth(100 - normalized.slice(0, -1).reduce((sum, width) => sum + width, 0))

  if (normalized.some((width) => width < MIN_COLUMN_WIDTH_PERCENT)) {
    return equalColumnWidths(count)
  }

  return normalized as ColumnWidths
}

export function resizeColumnWidths(
  widths: readonly number[],
  dividerIndex: number,
  deltaPercentage: number,
): ColumnWidths {
  const count = normalizeCount(widths.length)
  const normalized = normalizeColumnWidths(widths, count)
  if (dividerIndex < 0 || dividerIndex >= count - 1 || !Number.isFinite(deltaPercentage)) {
    return normalized
  }

  const pairTotal = normalized[dividerIndex] + normalized[dividerIndex + 1]
  const minimum = Math.min(MIN_COLUMN_WIDTH_PERCENT, pairTotal / 2)
  const nextLeft = Math.min(
    pairTotal - minimum,
    Math.max(minimum, normalized[dividerIndex] + deltaPercentage),
  )
  const nextWidths = [...normalized]
  nextWidths[dividerIndex] = roundColumnWidth(nextLeft)
  nextWidths[dividerIndex + 1] = roundColumnWidth(pairTotal - nextLeft)
  return nextWidths as ColumnWidths
}

export function columnGridTemplate(value: unknown, count: ColumnsCount) {
  return normalizeColumnWidths(value, count)
    .map((width) => `minmax(0, ${width}fr)`)
    .join(" ")
}

export function serializeColumnWidths(value: unknown, count: ColumnsCount) {
  return normalizeColumnWidths(value, count).join(",")
}

function parseColumnWidths(value: string | null, count: ColumnsCount) {
  return normalizeColumnWidths(value?.split(","), count)
}

function normalizeCount(value: unknown): ColumnsCount {
  return typeof value === "number" && Number.isInteger(value) && value >= 2 && value <= 6
    ? value as ColumnsCount
    : 2
}

function normalizeGap(value: unknown): ColumnsGap {
  return value === "compact" || value === "wide" ? value : "default"
}

export const Columns = Node.create({
  name: "columns",

  group: "block",

  content: "column{2,6}",

  isolating: true,

  defining: true,

  addAttributes() {
    return {
      count: {
        default: 2,
        parseHTML: (element) => normalizeCount(Number(element.getAttribute("data-count"))),
        renderHTML: (attributes) => ({
          "data-count": normalizeCount(attributes.count),
        }),
      },
      gap: {
        default: "default",
        parseHTML: (element) => normalizeGap(element.getAttribute("data-gap")),
        renderHTML: (attributes) => ({
          "data-gap": normalizeGap(attributes.gap),
        }),
      },
      widths: {
        default: null,
        parseHTML: (element) => {
          const count = normalizeCount(Number(element.getAttribute("data-count")))
          return parseColumnWidths(element.getAttribute("data-widths"), count)
        },
        renderHTML: (attributes) => {
          const count = normalizeCount(attributes.count)
          const widths = normalizeColumnWidths(attributes.widths, count)
          return {
            "data-widths": serializeColumnWidths(widths, count),
            style: `grid-template-columns: ${columnGridTemplate(widths, count)}`,
          }
        },
      },
    }
  },

  parseHTML() {
    return [{ tag: "div[data-td-columns]" }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-td-columns": "",
        class: "td-columns",
      }),
      0,
    ]
  },

})
