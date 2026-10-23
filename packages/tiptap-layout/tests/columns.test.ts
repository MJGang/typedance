// @vitest-environment jsdom
import { Editor, Node } from "@tiptap/core"
import { describe, expect, it } from "vitest"
import { Columns } from "../src/columns"
import { Column } from "../src/column"

const Document = Node.create({ name: "doc", topNode: true, content: "block+" })
const Paragraph = Node.create({ name: "paragraph", group: "block", content: "text*", parseHTML: () => [{ tag: "p" }], renderHTML: () => ["p", 0] })
const Text = Node.create({ name: "text", group: "inline" })
const extensions = [Document, Paragraph, Text, Columns, Column]

describe("@typedance/tiptap-layout schema and serialization", () => {
  it("exports columns and column nodes", () => {
    expect(Columns.name).toBe("columns")
    expect(Column.name).toBe("column")
  })

  it.each([2, 4, 6])("round-trips %i columns, custom widths, gaps and all text through HTML", (count) => {
    const widths = count === 2 ? [60, 40] : count === 4 ? [40, 15, 15, 30] : [25, 15, 15, 15, 15, 15]
    const editor = new Editor({ extensions, content: { type: "doc", content: [{ type: "columns", attrs: { count, gap: "wide", widths }, content: Array.from({ length: count }, (_, index) => ({ type: "column", content: [{ type: "paragraph", content: [{ type: "text", text: `第${index + 1}栏` }] }] })) }] } })
    const restored = new Editor({ extensions, content: editor.getHTML() })
    try {
      expect(restored.getJSON()).toEqual(editor.getJSON())
      expect(editor.getHTML()).toContain(`data-widths="${widths.join(",")}"`)
      expect(editor.state.doc.check()).toBeUndefined()
    } finally { restored.destroy(); editor.destroy() }
  })
})
