import { mergeAttributes, Node } from "@tiptap/core"

export const Column = Node.create({
  name: "column",

  content: "block+",

  isolating: true,

  parseHTML() {
    return [{ tag: "div[data-td-column]" }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-td-column": "",
        class: "td-column",
      }),
      0,
    ]
  },
})
