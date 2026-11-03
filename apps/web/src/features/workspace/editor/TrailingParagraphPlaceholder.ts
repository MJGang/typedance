import { Extension } from "@tiptap/core"
import { Plugin } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"

/** 与分页库共用的视图标记，不写入文档 JSON 或 HTML。 */
export const TRAILING_PARAGRAPH_PLACEHOLDER_ATTRIBUTE = "data-rm-pagination-ignore"

export const TrailingParagraphPlaceholder = Extension.create({
  name: "trailingParagraphPlaceholder",
  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        decorations({ doc }) {
          const last = doc.lastChild
          if (doc.childCount < 2 || last?.type.name !== "paragraph" || last.content.size > 0) return null
          // 连续空段落是用户主动保留的空行；只处理结构块之后的单个末尾输入位置。
          if (doc.child(doc.childCount - 2).type.name === "paragraph") return null
          const from = doc.content.size - last.nodeSize
          return DecorationSet.create(doc, [Decoration.node(from, doc.content.size, {
            [TRAILING_PARAGRAPH_PLACEHOLDER_ATTRIBUTE]: "true",
            // 脱离正文排版，同时保留一行宽的可点击区域和正常高度的光标。
            // 避开分页插件对空段落的 display: table 规则；输入文字后装饰自动移除。
            style: "position: absolute; z-index: 3; display: block; margin: 0; width: calc(var(--rm-page-width) - var(--rm-margin-left) - var(--rm-margin-right));",
          })])
        },
      },
    })]
  },
})
