import { mergeAttributes, Node } from "@tiptap/core"

export type ColumnsCount = 2 | 3
export type ColumnsGap = "compact" | "default" | "wide"
export type ColumnWidths = [number, number] | [number, number, number]

export type InsertColumnsOptions = {
  count?: ColumnsCount
  gap?: ColumnsGap
}

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
  const count: ColumnsCount = widths.length === 3 ? 3 : 2
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

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    columns: {
      insertColumns: (options?: InsertColumnsOptions) => ReturnType
      setColumnsCount: (count: ColumnsCount) => ReturnType
      setColumnsGap: (gap: ColumnsGap) => ReturnType
      unsetColumns: () => ReturnType
    }
  }
}

function normalizeCount(value: unknown): ColumnsCount {
  return value === 3 ? 3 : 2
}

function normalizeGap(value: unknown): ColumnsGap {
  return value === "compact" || value === "wide" ? value : "default"
}

export const Columns = Node.create({
  name: "columns",

  group: "block",

  content: "column+",

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

  addCommands() {
    return {
      insertColumns:
        (options = {}) =>
        ({ commands }) => {
          const count = normalizeCount(options.count)
          const gap = normalizeGap(options.gap)
          return commands.insertContent({
            type: this.name,
            attrs: { count, gap, widths: equalColumnWidths(count) },
            content: Array.from({ length: count }, () => ({
              type: "column",
              content: [{ type: "paragraph" }],
            })),
          })
        },
      setColumnsCount:
        (count) =>
        ({ state, dispatch }) => {
          const targetCount = normalizeCount(count)
          const { $from } = state.selection
          let columnsDepth: number | null = null

          for (let depth = $from.depth; depth > 0; depth -= 1) {
            if ($from.node(depth).type.name === this.name) {
              columnsDepth = depth
              break
            }
          }

          if (columnsDepth === null) {
            return false
          }

          const currentNode = $from.node(columnsDepth)
          const columnsPos = $from.before(columnsDepth)
          const columnType = state.schema.nodes.column
          const paragraphType = state.schema.nodes.paragraph

          if (!columnType || !paragraphType) {
            return false
          }

          const nextColumns = Array.from({ length: targetCount }, (_, index) => {
            if (index < currentNode.childCount) {
              return currentNode.child(index)
            }

            return columnType.create(null, paragraphType.create())
          })

          if (targetCount < currentNode.childCount) {
            const lastColumn = nextColumns[targetCount - 1]
            const mergedContent = Array.from({ length: lastColumn.childCount }, (_, index) => lastColumn.child(index))

            for (let index = targetCount; index < currentNode.childCount; index += 1) {
              const removedColumn = currentNode.child(index)
              for (let childIndex = 0; childIndex < removedColumn.childCount; childIndex += 1) {
                mergedContent.push(removedColumn.child(childIndex))
              }
            }

            nextColumns[targetCount - 1] = columnType.create(lastColumn.attrs, mergedContent)
          }

          const nextNode = currentNode.type.create(
            {
              ...currentNode.attrs,
              count: targetCount,
              widths: targetCount === normalizeCount(currentNode.attrs.count)
                ? normalizeColumnWidths(currentNode.attrs.widths, targetCount)
                : equalColumnWidths(targetCount),
            },
            nextColumns,
          )

          if (dispatch) {
            dispatch(
              state.tr
                .replaceWith(columnsPos, columnsPos + currentNode.nodeSize, nextNode)
                .scrollIntoView(),
            )
          }

          return true
        },
      setColumnsGap:
        (gap) =>
        ({ commands }) => {
          return commands.updateAttributes(this.name, { gap: normalizeGap(gap) })
        },
      unsetColumns:
        () =>
        ({ state, dispatch }) => {
          const { $from } = state.selection
          let columnsDepth: number | null = null

          for (let depth = $from.depth; depth > 0; depth -= 1) {
            if ($from.node(depth).type.name === this.name) {
              columnsDepth = depth
              break
            }
          }

          if (columnsDepth === null) {
            return false
          }

          const currentNode = $from.node(columnsDepth)
          const columnsPos = $from.before(columnsDepth)
          const paragraphType = state.schema.nodes.paragraph
          const content = []

          for (let index = 0; index < currentNode.childCount; index += 1) {
            const column = currentNode.child(index)
            for (let childIndex = 0; childIndex < column.childCount; childIndex += 1) {
              content.push(column.child(childIndex))
            }
          }

          if (content.length === 0 && paragraphType) {
            content.push(paragraphType.create())
          }

          if (dispatch) {
            dispatch(
              state.tr
                .replaceWith(columnsPos, columnsPos + currentNode.nodeSize, content)
                .scrollIntoView(),
            )
          }

          return true
        },
    }
  },
})
