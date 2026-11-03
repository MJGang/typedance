import { Extension } from "@tiptap/core"
import { Plugin, NodeSelection } from "@tiptap/pm/state"

// 扩大命中区域只使用伪元素，不改变正文尺寸，也不进入 HTML/PDF 打印快照。
export const DIVIDER_EDITOR_CSS = `
.td-rich-editor .ProseMirror[contenteditable="true"] hr { position: relative; overflow: visible; cursor: pointer; }
.td-rich-editor .ProseMirror[contenteditable="true"] hr::after { content: ""; position: absolute; inset: -6px 0; }
.td-rich-editor .ProseMirror[contenteditable="true"] hr.ProseMirror-selectednode { outline: 2px solid #2563eb; outline-offset: 3px; }
`

export const DividerSelection = Extension.create({
  name: "dividerSelection",
  addProseMirrorPlugins() {
    return [new Plugin({ props: {
      handleClickOn: (view, _pos, node, nodePos, event, direct) => {
        if (!this.editor.isEditable || !direct || event.shiftKey || event.ctrlKey || event.metaKey || node.type.name !== "horizontalRule") return false
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, nodePos)))
        view.focus()
        return true
      },
    } })]
  },
})
