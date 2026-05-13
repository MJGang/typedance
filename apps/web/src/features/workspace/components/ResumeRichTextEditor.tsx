import { useEffect, useRef } from "react"
import { EditorContent, useEditor, useEditorState } from "@tiptap/react"
import type { JSONContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import DragHandleExtension from "@tiptap/extension-drag-handle"
import DragHandle from "@tiptap/extension-drag-handle-react"
import { PaginationPlus, PAGE_SIZES } from "tiptap-pagination-plus"
import { Bold, Heading2, Italic, List, Pilcrow } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { ResumeDocJson, ResumeEditorChange } from "../editor"

type MarginConfig = {
  top: number
  bottom: number
  left: number
  right: number
}

type ResumeRichTextEditorProps = {
  ariaLabel: string
  docJson: ResumeDocJson
  onChange: (change: ResumeEditorChange) => void
  onSelectionUpdate?: (blockType: string) => void
  editable?: boolean
  cssText?: string
  marginConfig?: MarginConfig
  onMarginChange?: (margins: MarginConfig) => void
}

type ToolbarState = {
  isBold: boolean
  isItalic: boolean
  isHeading2: boolean
  isBulletList: boolean
  isParagraph: boolean
}

const inactiveToolbarState: ToolbarState = {
  isBold: false,
  isItalic: false,
  isHeading2: false,
  isBulletList: false,
  isParagraph: false,
}

export function ResumeRichTextEditor({
  ariaLabel,
  docJson,
  onChange,
  onSelectionUpdate,
  editable = true,
  cssText = "",
  marginConfig,
  onMarginChange,
}: ResumeRichTextEditorProps) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onSelectionUpdateRef = useRef(onSelectionUpdate)
  onSelectionUpdateRef.current = onSelectionUpdate

  const editor = useEditor({
    extensions: [
      StarterKit,
      DragHandleExtension.configure({
        nested: true,
      }),
      PaginationPlus.configure({
        enabled: true,
        pageGap: 24,
        pageGapBorderSize: 1,
        pageGapBorderColor: "#e5e5e5",
        pageBreakBackground: "transparent",
        ...PAGE_SIZES.A4,
        marginTop: marginConfig?.top ?? 76,
        marginBottom: marginConfig?.bottom ?? 76,
        marginLeft: marginConfig?.left ?? 50,
        marginRight: marginConfig?.right ?? 50,
        contentMarginTop: 10,
        contentMarginBottom: 10,
      }),
    ],
    content: docJson as unknown as JSONContent,
    editable,
    editorProps: {
      attributes: {
        "aria-label": ariaLabel,
        class: "td-rich-editor-prosemirror",
      },
    },
    onUpdate: ({ editor }) => {
      onChangeRef.current({
        plainText: editor.getText({ blockSeparator: "\n\n" }),
        docJson: editor.getJSON() as ResumeDocJson,
      })
    },
    onSelectionUpdate: ({ editor }) => {
      const onUpdate = onSelectionUpdateRef.current
      if (!onUpdate) return
      const { $from } = editor.state.selection
      const node = $from.parent
      if (node.type.name === "heading") {
        onUpdate(`heading${node.attrs.level}`)
      } else {
        onUpdate(node.type.name)
      }
    },
  })

  const toolbarState =
    useEditorState<ToolbarState>({
      editor,
      selector: ({ editor }) => {
        if (!editor) return inactiveToolbarState
        return {
          isBold: editor.isActive("bold"),
          isItalic: editor.isActive("italic"),
          isHeading2: editor.isActive("heading", { level: 2 }),
          isBulletList: editor.isActive("bulletList"),
          isParagraph: editor.isActive("paragraph"),
        }
      },
    }) ?? inactiveToolbarState

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    if (editor.isEditable !== editable) {
      editor.setEditable(editable)
    }
    const current = JSON.stringify(editor.getJSON())
    const next = JSON.stringify(docJson)
    if (current !== next) {
      editor.commands.setContent(docJson as unknown as JSONContent, { emitUpdate: false })
    }
  }, [docJson, editor, editable])

  return (
    <div className="td-rich-editor">
      {editable && (
        <div className="td-rich-editor-toolbar" role="toolbar" aria-label="简历格式工具栏">
          <Button
            type="button"
            variant={toolbarState.isBold ? "default" : "outline"}
            size="icon"
            aria-label="加粗"
            onClick={() => editor?.chain().focus().toggleBold().run()}
            disabled={!editor}
          >
            <Bold />
          </Button>
          <Button
            type="button"
            variant={toolbarState.isItalic ? "default" : "outline"}
            size="icon"
            aria-label="斜体"
            onClick={() => editor?.chain().focus().toggleItalic().run()}
            disabled={!editor}
          >
            <Italic />
          </Button>
          <Button
            type="button"
            variant={toolbarState.isHeading2 ? "default" : "outline"}
            size="icon"
            aria-label="二级标题"
            onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
            disabled={!editor}
          >
            <Heading2 />
          </Button>
          <Button
            type="button"
            variant={toolbarState.isBulletList ? "default" : "outline"}
            size="icon"
            aria-label="无序列表"
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
            disabled={!editor}
          >
            <List />
          </Button>
          <Button
            type="button"
            variant={toolbarState.isParagraph ? "default" : "outline"}
            size="icon"
            aria-label="段落"
            onClick={() => editor?.chain().focus().setParagraph().run()}
            disabled={!editor}
          >
            <Pilcrow />
          </Button>
        </div>
      )}
      <style>{cssText}</style>
      <DragHandle editor={editor}>
        <div className="td-drag-handle" />
      </DragHandle>
      <div className="td-editor-print-wrapper">
        <EditorContent editor={editor} className="td-rich-editor-content" />
      </div>
    </div>
  )
}
