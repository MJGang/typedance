import { mergeAttributes, Node } from "@tiptap/core"

export type ColumnsCount = 1 | 2 | 3
export type ColumnsGap = "compact" | "default" | "wide"

export type InsertColumnsOptions = {
  count?: ColumnsCount
  gap?: ColumnsGap
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
  return value === 1 || value === 2 || value === 3 ? value : 2
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
            attrs: { count, gap },
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
            { ...currentNode.attrs, count: targetCount },
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
