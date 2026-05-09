import { useEffect } from "react"
import { EditorContent, useEditor } from "@tiptap/react"
import type { JSONContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { Bold, Heading2, Italic, List, Pilcrow } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { ResumeDocJson, ResumeEditorChange } from "../editor"

type ResumeRichTextEditorProps = {
  ariaLabel: string
  docJson: ResumeDocJson
  onChange: (change: ResumeEditorChange) => void
}

export function ResumeRichTextEditor({
  ariaLabel,
  docJson,
  onChange,
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
  })

  useEffect(() => {
    if (!editor || editor.isDestroyed) {
      return
    }

    const current = JSON.stringify(editor.getJSON())
    const next = JSON.stringify(docJson)

    if (current !== next) {
      editor.commands.setContent(docJson as unknown as JSONContent)
    }
  }, [docJson, editor])

  return (
    <div className="td-rich-editor">
      <div className="td-rich-editor-toolbar" aria-label="简历格式工具栏">
        <Button
          type="button"
          variant={editor?.isActive("bold") ? "default" : "outline"}
          size="icon"
          aria-label="加粗"
          onClick={() => editor?.chain().focus().toggleBold().run()}
          disabled={!editor}
        >
          <Bold />
        </Button>
        <Button
          type="button"
          variant={editor?.isActive("italic") ? "default" : "outline"}
          size="icon"
          aria-label="斜体"
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          disabled={!editor}
        >
          <Italic />
        </Button>
        <Button
          type="button"
          variant={editor?.isActive("heading", { level: 2 }) ? "default" : "outline"}
          size="icon"
          aria-label="二级标题"
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          disabled={!editor}
        >
          <Heading2 />
        </Button>
        <Button
          type="button"
          variant={editor?.isActive("bulletList") ? "default" : "outline"}
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
