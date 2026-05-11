import { useEffect } from "react"
import { EditorContent, useEditor, useEditorState } from "@tiptap/react"
import type { JSONContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { Bold, Heading2, Italic, List, Pilcrow } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { ResumeDocJson, ResumeEditorChange } from "../editor"

type ResumeRichTextEditorProps = {
  ariaLabel: string
  docJson: ResumeDocJson
  onChange: (change: ResumeEditorChange) => void
  onSelectionUpdate?: (blockType: string) => void
}

type ToolbarState = {
  isBold: boolean
  isItalic: boolean
  isHeading2: boolean
  isBulletList: boolean
}

const inactiveToolbarState: ToolbarState = {
  isBold: false,
  isItalic: false,
  isHeading2: false,
  isBulletList: false,
}

export function ResumeRichTextEditor({
  ariaLabel,
  docJson,
  onChange,
  onSelectionUpdate,
}: ResumeRichTextEditorProps) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: docJson as unknown as JSONContent,
    editorProps: {
      attributes: {
        "aria-label": ariaLabel,
        class: "td-rich-editor-prosemirror",
      },
    },
    onUpdate: ({ editor }) => {
      onChange({
        plainText: editor.getText({ blockSeparator: "\n\n" }),
        docJson: editor.getJSON() as ResumeDocJson,
      })
    },
    onSelectionUpdate: ({ editor }: { editor: { state: { selection: { $from: { parent: { type: { name: string }; attrs: { level?: number } } } } } } }) => {
      if (!onSelectionUpdate) return
      const { $from } = editor.state.selection
      const node = $from.parent
      if (node.type.name === "heading") {
        onSelectionUpdate(`heading${node.attrs.level}`)
      } else {
        onSelectionUpdate(node.type.name)
      }
    },
  })

  const toolbarState =
    useEditorState<ToolbarState>({
      editor,
      selector: ({ editor }) => {
        if (!editor) {
          return inactiveToolbarState
        }

        return {
          isBold: editor.isActive("bold"),
          isItalic: editor.isActive("italic"),
          isHeading2: editor.isActive("heading", { level: 2 }),
          isBulletList: editor.isActive("bulletList"),
        }
      },
    }) ?? inactiveToolbarState

  useEffect(() => {
    if (!editor || editor.isDestroyed) {
      return
    }

    const current = JSON.stringify(editor.getJSON())
    const next = JSON.stringify(docJson)

    if (current !== next) {
      editor.commands.setContent(docJson as unknown as JSONContent, { emitUpdate: false })
    }
  }, [docJson, editor])

  return (
    <div className="td-rich-editor">
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
          variant="outline"
          size="icon"
          aria-label="段落"
          onClick={() => editor?.chain().focus().setParagraph().run()}
          disabled={!editor}
        >
          <Pilcrow />
        </Button>
      </div>
      <EditorContent editor={editor} className="td-rich-editor-content" />
    </div>
  )
}
