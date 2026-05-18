import { forwardRef, useEffect, useImperativeHandle, useRef } from "react"
import type { ReactNode } from "react"
import { EditorContent, useEditor, useEditorState } from "@tiptap/react"
import type { JSONContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import DragHandle from "@tiptap/extension-drag-handle-react"
import { PaginationPlus, PAGE_SIZES } from "tiptap-pagination-plus"
import { Bold, Columns3, GripVertical, Heading1, Heading2, Heading3, Italic, List, ListOrdered, Pilcrow } from "lucide-react"
import { Column, Columns, type ColumnsCount, type ColumnsGap } from "@typedance/tiptap-layout"

import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
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
  onSelectionUpdate?: (blockType: string, context?: ResumeSelectionContext) => void
  editable?: boolean
  cssText?: string
  marginConfig?: MarginConfig
  onMarginChange?: (margins: MarginConfig) => void
}

export type ResumeSelectionContext = {
  columns?: {
    count: ColumnsCount
    gap: ColumnsGap
  }
}

export type ResumeRichTextEditorHandle = {
  setColumnsCount: (count: ColumnsCount) => void
  setColumnsGap: (gap: ColumnsGap) => void
  unsetColumns: () => void
}

type ToolbarState = {
  isBold: boolean
  isItalic: boolean
  isHeading1: boolean
  isHeading2: boolean
  isHeading3: boolean
  isBulletList: boolean
  isOrderedList: boolean
  isParagraph: boolean
  isColumns: boolean
}

const inactiveToolbarState: ToolbarState = {
  isBold: false,
  isItalic: false,
  isHeading1: false,
  isHeading2: false,
  isHeading3: false,
  isBulletList: false,
  isOrderedList: false,
  isParagraph: false,
  isColumns: false,
}

type ToolbarButtonProps = {
  label: string
  isActive?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}

function ToolbarButton({ label, isActive = false, disabled = false, onClick, children }: ToolbarButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={isActive ? "default" : "outline"}
          size="icon"
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function getSelectedColumnsContext(editor: NonNullable<ReturnType<typeof useEditor>>): ResumeSelectionContext["columns"] | null {
  const { $from } = editor.state.selection

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const ancestor = $from.node(depth)
    if (ancestor.type.name === "columns") {
      return {
        count: ancestor.attrs.count === 1 || ancestor.attrs.count === 3 ? ancestor.attrs.count : 2,
        gap: ancestor.attrs.gap === "compact" || ancestor.attrs.gap === "wide" ? ancestor.attrs.gap : "default",
      }
    }
  }

  return null
}

export const ResumeRichTextEditor = forwardRef<ResumeRichTextEditorHandle, ResumeRichTextEditorProps>(
  function ResumeRichTextEditor(
    {
      ariaLabel,
      docJson,
      onChange,
      onSelectionUpdate,
      editable = true,
      cssText = "",
      marginConfig,
    },
    ref,
  ) {
    const onChangeRef = useRef(onChange)
    onChangeRef.current = onChange
    const onSelectionUpdateRef = useRef(onSelectionUpdate)
    onSelectionUpdateRef.current = onSelectionUpdate

    const editor = useEditor({
      extensions: [
        StarterKit,
        Columns,
        Column,
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
          headerLeft: "",
          headerRight: "",
          footerLeft: "",
          footerRight: "",
        }),
      ],
      content: docJson as unknown as JSONContent,
      editable,
      editorProps: {
        attributes: {
          "aria-label": ariaLabel,
          // class: "td-rich-editor-prosemirror",
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

        const columnsContext = getSelectedColumnsContext(editor)
        if (columnsContext) {
          onUpdate("columns", { columns: columnsContext })
          return
        }

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
            isHeading1: editor.isActive("heading", { level: 1 }),
            isHeading2: editor.isActive("heading", { level: 2 }),
            isHeading3: editor.isActive("heading", { level: 3 }),
            isBulletList: editor.isActive("bulletList"),
            isOrderedList: editor.isActive("orderedList"),
            isParagraph: editor.isActive("paragraph"),
            isColumns: editor.isActive("columns"),
          }
        },
      }) ?? inactiveToolbarState

    useImperativeHandle(ref, () => ({
      setColumnsCount: (count) => {
        editor?.chain().focus().setColumnsCount(count).run()
      },
      setColumnsGap: (gap) => {
        editor?.chain().focus().setColumnsGap(gap).run()
      },
      unsetColumns: () => {
        editor?.chain().focus().unsetColumns().run()
      },
    }), [editor])

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
            <ToolbarButton
              label="加粗"
              isActive={toolbarState.isBold}
              disabled={!editor}
              onClick={() => editor?.chain().focus().toggleBold().run()}
            >
              <Bold />
            </ToolbarButton>
            <ToolbarButton
              label="斜体"
              isActive={toolbarState.isItalic}
              disabled={!editor}
              onClick={() => editor?.chain().focus().toggleItalic().run()}
            >
              <Italic />
            </ToolbarButton>
            <ToolbarButton
              label="一级标题"
              isActive={toolbarState.isHeading1}
              disabled={!editor}
              onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
            >
              <Heading1 />
            </ToolbarButton>
            <ToolbarButton
              label="二级标题"
              isActive={toolbarState.isHeading2}
              disabled={!editor}
              onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
            >
              <Heading2 />
            </ToolbarButton>
            <ToolbarButton
              label="三级标题"
              isActive={toolbarState.isHeading3}
              disabled={!editor}
              onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
            >
              <Heading3 />
            </ToolbarButton>
            <ToolbarButton
              label="正文"
              isActive={toolbarState.isParagraph}
              disabled={!editor}
              onClick={() => editor?.chain().focus().setParagraph().run()}
            >
              <Pilcrow />
            </ToolbarButton>
            <ToolbarButton
              label="无序列表"
              isActive={toolbarState.isBulletList}
              disabled={!editor}
              onClick={() => editor?.chain().focus().toggleBulletList().run()}
            >
              <List />
            </ToolbarButton>
            <ToolbarButton
              label="有序列表"
              isActive={toolbarState.isOrderedList}
              disabled={!editor}
              onClick={() => editor?.chain().focus().toggleOrderedList().run()}
            >
              <ListOrdered />
            </ToolbarButton>
            <Popover>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant={toolbarState.isColumns ? "default" : "outline"}
                      size="icon"
                      aria-label="分栏"
                      disabled={!editor}
                    >
                      <Columns3 />
                    </Button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent>分栏</TooltipContent>
              </Tooltip>
              <PopoverContent align="start" className="w-40 p-2">
                <div className="flex flex-col gap-1">
                  {([1, 2, 3] as ColumnsCount[]).map((count) => (
                    <Button
                      key={count}
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="justify-start"
                      onClick={() => editor?.chain().focus().insertColumns({ count }).run()}
                    >
                      {count} 栏
                    </Button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        )}
        <style>{cssText}</style>
        <DragHandle editor={editor}>
          <div className="td-drag-handle">
            <GripVertical className="h-4 w-4" />
          </div>
        </DragHandle>
        <div className="td-editor-print-wrapper">
          <EditorContent editor={editor} className="td-rich-editor-content" />
        </div>
      </div>
    )
  },
)
