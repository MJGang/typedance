// @vitest-environment jsdom
import { Editor, Node } from "@tiptap/core"
import { describe, expect, it } from "vitest"
import { Timeline, TimelineItem } from "../src/timeline"

const Document = Node.create({ name: "doc", topNode: true, content: "block+" })
const Paragraph = Node.create({ name: "paragraph", group: "block", content: "text*", parseHTML: () => [{ tag: "p" }], renderHTML: () => ["p", 0] })
const Text = Node.create({ name: "text", group: "inline" })
const extensions = [Document, Paragraph, Text, Timeline, TimelineItem]

describe("timeline schema", () => {
  it("round-trips multiple rich text blocks per item through HTML without decoration text", () => {
    const editor = new Editor({ extensions, content: { type: "doc", content: [{ type: "timeline", content: [
      { type: "timelineItem", content: [{ type: "paragraph", content: [{ type: "text", text: "公司 A" }] }, { type: "paragraph", content: [{ type: "text", text: "成果 A" }] }] },
      { type: "timelineItem", content: [{ type: "paragraph" }] },
    ] }] } })
    const restored = new Editor({ extensions, content: editor.getHTML() })
    try {
      expect(restored.getJSON()).toEqual(editor.getJSON())
      expect(editor.getHTML()).toContain('class="td-timeline-dot"')
      expect(editor.getText()).toContain("成果 A")
      expect(editor.state.doc.check()).toBeUndefined()
    } finally { restored.destroy(); editor.destroy() }
  })
})
