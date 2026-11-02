import { mergeAttributes, Node } from "@tiptap/core"

export const Timeline = Node.create({
  name: "timeline",
  group: "block",
  content: "timelineItem+",
  defining: true,
  isolating: true,
  parseHTML() { return [{ tag: "div[data-td-timeline]" }] },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-td-timeline": "", class: "td-timeline" }), 0]
  },
})

export const TimelineItem = Node.create({
  name: "timelineItem",
  content: "block+",
  defining: true,
  isolating: true,
  parseHTML() { return [{ tag: "div[data-td-timeline-item]", contentElement: ".td-timeline-body" }] },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-td-timeline-item": "", class: "td-timeline-item" }),
      ["span", { class: "td-timeline-line", "aria-hidden": "true", contenteditable: "false" }],
      ["span", { class: "td-timeline-dot", "aria-hidden": "true", contenteditable: "false" }],
      ["div", { class: "td-timeline-body" }, 0],
    ]
  },
})
