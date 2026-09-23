// @vitest-environment jsdom
import { Editor, Node } from "@tiptap/core"
import { describe, expect, it } from "vitest"
import { Columns } from "../src/columns"
import { Column } from "../src/column"

const Document = Node.create({ name: "doc", topNode: true, content: "block+" })
const Paragraph = Node.create({
  name: "paragraph",
  group: "block",
  content: "text*",
  parseHTML: () => [{ tag: "p" }],
  renderHTML: () => ["p", 0],
})
const Text = Node.create({ name: "text", group: "inline" })

function columnsEditor(count: number, widths: number[], labels: string[]) {
  return new Editor({
    extensions: [Document, Paragraph, Text, Columns, Column],
    content: {
      type: "doc",
      content: [{
        type: "columns",
        attrs: { count, gap: "default", widths },
        content: labels.map((label) => ({
          type: "column",
          content: [{ type: "paragraph", content: [{ type: "text", text: label }] }],
        })),
      }],
    },
  })
}

type ColumnCommands = {
  insertColumnAt?: (position: number, afterIndex: number) => boolean
  removeColumnAt?: (position: number, index: number) => boolean
  moveColumnAt?: (position: number, fromIndex: number, toIndex: number) => boolean
}

function columnLabels(editor: Editor) {
  const columns = editor.getJSON().content?.[0]?.content as Array<{
    content?: Array<{ content?: Array<{ text?: string }> }>
  }> | undefined
  return columns?.map((column) => column.content?.[0]?.content?.[0]?.text ?? "")
}

describe("@typedance/tiptap-layout", () => {
  it("exports columns and column nodes", () => {
    expect(Columns.name).toBe("columns")
    expect(Column.name).toBe("column")
  })

  it("inserts an empty column between existing content without discarding custom widths", () => {
    const editor = columnsEditor(2, [60, 40], ["左", "右"])
    const commands = editor.commands as ColumnCommands

    expect(commands.insertColumnAt?.(0, 0)).toBe(true)
    const columns = editor.getJSON().content?.[0]
    expect(columns?.attrs?.count).toBe(3)
    expect(columnLabels(editor)).toEqual(["左", "", "右"])
    expect(columns?.attrs?.widths).toHaveLength(3)
    expect(columns?.attrs?.widths.reduce((sum: number, width: number) => sum + width, 0)).toBeCloseTo(100)
    editor.destroy()
  })

  it("appends a sixth column and refuses a seventh", () => {
    const editor = columnsEditor(5, [20, 20, 20, 20, 20], ["一", "二", "三", "四", "五"])
    const commands = editor.commands as ColumnCommands

    expect(commands.insertColumnAt?.(0, 4)).toBe(true)
    const columns = editor.getJSON().content?.[0]
    expect(columns?.content).toHaveLength(6)
    expect(columns?.attrs?.widths.reduce((sum: number, width: number) => sum + width, 0)).toBeCloseTo(100)
    expect(columns?.attrs?.widths.every((width: number) => width >= 15)).toBe(true)
    expect((editor.commands as ColumnCommands).insertColumnAt?.(0, 5)).toBe(false)
    expect(editor.getJSON().content?.[0]?.content).toHaveLength(6)
    editor.destroy()
  })

  it("moves column content and width together", () => {
    const editor = columnsEditor(3, [30, 40, 30], ["甲", "乙", "丙"])
    const commands = editor.commands as ColumnCommands

    expect(commands.moveColumnAt?.(0, 0, 2)).toBe(true)
    const columns = editor.getJSON().content?.[0]
    expect(columnLabels(editor)).toEqual(["乙", "丙", "甲"])
    expect(columns?.attrs?.widths).toEqual([40, 30, 30])
    editor.destroy()
  })

  it("removes a column and unwraps the survivor when two remain", () => {
    const editor = columnsEditor(2, [60, 40], ["删除", "保留"])
    const commands = editor.commands as ColumnCommands

    expect(commands.removeColumnAt?.(0, 0)).toBe(true)
    expect(editor.getJSON().content).toEqual([{ type: "paragraph", content: [{ type: "text", text: "保留" }] }])
    editor.destroy()
  })

  it("redistributes a deleted column's width so the remaining columns fill the row", () => {
    const editor = columnsEditor(3, [30, 40, 30], ["甲", "乙", "丙"])

    expect((editor.commands as ColumnCommands).removeColumnAt?.(0, 1)).toBe(true)
    expect(columnLabels(editor)).toEqual(["甲", "丙"])
    expect(editor.getJSON().content?.[0]?.attrs?.widths).toEqual([70, 30])
    editor.destroy()
  })
})
