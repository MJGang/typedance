import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type PointerEvent } from "react"
import { Extension, Mark, type Editor } from "@tiptap/core"
import { Markdown } from "@tiptap/markdown"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { Plugin } from "@tiptap/pm/state"
import { EditorContent, useEditor, useEditorState } from "@tiptap/react"
import type { JSONContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import DragHandle from "@tiptap/extension-drag-handle-react"
import { PaginationPlus, PAGE_SIZES } from "tiptap-pagination-plus"
import { Bold, Columns3, Eraser, GripVertical, Heading1, Heading2, Heading3, Italic, List, ListOrdered, ListTree, Type, Underline } from "lucide-react"
import { Column, Columns, type ColumnsCount, type ColumnsGap } from "@typedance/tiptap-layout"

import { Button } from "@/components/ui/button"
import { ColorPickerPopover, DEFAULT_TEXT_COLOR } from "@/components/color-picker-popover"
import {
  AlignmentToolbarButton,
  BulletListToolbarButton,
  DividerToolbarButton,
  IndentToolbarButton,
  LineHeightToolbarButton,
  OrderedListToolbarButton,
  ToolbarGroup,
  ToolbarIconButton,
  ToolbarVerticalSeparator,
  type ToolbarAlignment,
  type ToolbarBulletListStyle,
  type ToolbarLineHeight,
  type ToolbarOrderedListStyle,
} from "@/components/editor-toolbar"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { looksLikeMarkdown } from "../editor"
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
  onSourceCanvasModuleChange?: (moduleId: string | null) => void
  editable?: boolean
  cssText?: string
  marginConfig?: MarginConfig
  onMarginChange?: (margins: MarginConfig) => void
  moduleOutlineVisible?: boolean
  onModuleOutlineVisibleChange?: (visible: boolean) => void
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
  setTextSelection: (selection: { anchor: number; head: number }) => void
  scrollToCanvasNode: (canvasNodeId: string, options?: { topOffset?: number }) => void
}

type ToolbarState = {
  isBold: boolean
  isItalic: boolean
  isUnderline: boolean
  isHeading1: boolean
  isHeading2: boolean
  isHeading3: boolean
  isBulletList: boolean
  isOrderedList: boolean
  isParagraph: boolean
  isColumns: boolean
  inlineColor: string
  inlineBackgroundColor: string | null
  inlineFontSize: string
  textAlign: ToolbarAlignment
  lineHeight: ToolbarLineHeight
  orderedListStyle: ToolbarOrderedListStyle
  bulletListStyle: ToolbarBulletListStyle
  indent: number
  activeBlock: ToolbarBlock
}

type ToolbarBlock = "paragraph" | "heading1" | "heading2" | "heading3" | "bulletList" | "orderedList" | "columns"

const inactiveToolbarState: ToolbarState = {
  isBold: false,
  isItalic: false,
  isUnderline: false,
  isHeading1: false,
  isHeading2: false,
  isHeading3: false,
  isBulletList: false,
  isOrderedList: false,
  isParagraph: false,
  isColumns: false,
  inlineColor: DEFAULT_TEXT_COLOR,
  inlineBackgroundColor: null,
  inlineFontSize: "",
  textAlign: "left",
  lineHeight: "default",
  orderedListStyle: "decimal",
  bulletListStyle: "disc",
  indent: 0,
  activeBlock: "paragraph",
}

const INLINE_FONT_SIZES = ["12px", "13px", "14px", "15px", "16px", "19px", "22px", "24px", "29px", "32px", "40px", "48px"]

const BLOCK_OPTIONS: Array<{ value: ToolbarBlock; label: string; icon: typeof Type }> = [
  { value: "paragraph", label: "正文", icon: Type },
  { value: "heading1", label: "标题1", icon: Heading1 },
  { value: "heading2", label: "标题2", icon: Heading2 },
  { value: "heading3", label: "标题3", icon: Heading3 },
]

const BLOCK_STYLE_NODE_TYPES = ["paragraph", "heading", "listItem"] as const
const DEFAULT_LINE_HEIGHT: ToolbarLineHeight = "default"
const DRAG_HANDLE_BLOCK_HIT_SLOP = 4
const MAX_INDENT = 8

type DragHandleBlockPresentation = {
  label: string
  icon: typeof Type
  iconClassName: string
}

const DRAG_HANDLE_BLOCK_PRESENTATIONS: Record<ToolbarBlock, DragHandleBlockPresentation> = {
  paragraph: { label: "正文", icon: Type, iconClassName: "lucide-type" },
  heading1: { label: "标题1", icon: Heading1, iconClassName: "lucide-heading-1" },
  heading2: { label: "标题2", icon: Heading2, iconClassName: "lucide-heading-2" },
  heading3: { label: "标题3", icon: Heading3, iconClassName: "lucide-heading-3" },
  bulletList: { label: "无序列表", icon: List, iconClassName: "lucide-list" },
  orderedList: { label: "有序列表", icon: ListOrdered, iconClassName: "lucide-list-ordered" },
  columns: { label: "分栏", icon: Columns3, iconClassName: "lucide-columns-3" },
}

export function getDragHandleBlockPresentation(block: ToolbarBlock): DragHandleBlockPresentation {
  return DRAG_HANDLE_BLOCK_PRESENTATIONS[block]
}

function getListAncestorBlockType(editor: Editor | undefined, pos: number): "bulletList" | "orderedList" | null {
  if (!editor || pos < 0) return null

  const resolvedPos = Math.min(Math.max(pos + 1, 0), editor.state.doc.content.size)
  const $pos = editor.state.doc.resolve(resolvedPos)

  for (let depth = $pos.depth; depth >= 0; depth -= 1) {
    const nodeType = $pos.node(depth).type.name
    if (nodeType === "bulletList" || nodeType === "orderedList") return nodeType
  }

  return null
}

export function getDragHandleBlockType(node: ProseMirrorNode | null, editor?: Editor, pos = -1): ToolbarBlock {
  if (!node) return "paragraph"

  if (node.type.name === "bulletList") return "bulletList"
  if (node.type.name === "orderedList") return "orderedList"

  const listAncestor = getListAncestorBlockType(editor, pos)
  if (listAncestor) return listAncestor

  if (node.type.name === "heading") {
    const level = node.attrs.level === 1 || node.attrs.level === 2 || node.attrs.level === 3 ? node.attrs.level : 1
    return `heading${level}` as "heading1" | "heading2" | "heading3"
  }

  if (node.type.name === "columns") return "columns"
  if (node.type.name === "listItem") return "bulletList"

  return "paragraph"
}

export function isPointerWithinDragHandleBlock(
  pointer: { clientY: number } | null,
  rect: Pick<DOMRectReadOnly, "top" | "bottom" | "height"> | null,
) {
  if (!pointer || !rect || rect.height <= 0) return false
  return pointer.clientY >= rect.top - DRAG_HANDLE_BLOCK_HIT_SLOP
    && pointer.clientY <= rect.bottom + DRAG_HANDLE_BLOCK_HIT_SLOP
}

function getDragHandleNodeElement(editor: Editor, pos: number) {
  if (pos < 0) return null
  const nodeDom = editor.view.nodeDOM(pos)
  return nodeDom instanceof HTMLElement ? nodeDom : null
}

function ResumeDragHandleChrome({ block }: { block: ToolbarBlock }) {
  const presentation = getDragHandleBlockPresentation(block)
  const Icon = presentation.icon

  return (
    <div
      className="td-drag-handle-shell"
      data-block-type={block}
      data-testid="resume-drag-handle"
      aria-label={`拖拽${presentation.label}块`}
      title={`拖拽${presentation.label}块`}
    >
      <span className="td-drag-handle">
        <Icon className="td-drag-handle-kind-icon" />
        <GripVertical className="td-drag-handle-grip-icon" />
      </span>
    </div>
  )
}

function inlineStyleToCss(attrs: Record<string, unknown>): string {
  const rules: string[] = []
  if (typeof attrs.fontSize === "string" && attrs.fontSize.endsWith("px")) {
    rules.push(`font-size: ${attrs.fontSize}`)
  }
  if (typeof attrs.color === "string" && /^#[0-9a-fA-F]{6}$/.test(attrs.color)) {
    rules.push(`color: ${attrs.color}`)
  }
  if (typeof attrs.backgroundColor === "string" && /^#[0-9a-fA-F]{6}$/.test(attrs.backgroundColor)) {
    rules.push(`background-color: ${attrs.backgroundColor}`)
  }
  return rules.join("; ")
}

function blockStyleToCss(attrs: Record<string, unknown>): string {
  const rules: string[] = []
  if (attrs.textAlign === "left" || attrs.textAlign === "center" || attrs.textAlign === "right" || attrs.textAlign === "justify") {
    rules.push(`text-align: ${attrs.textAlign}`)
  }
  if (typeof attrs.lineHeight === "string" && attrs.lineHeight !== DEFAULT_LINE_HEIGHT) {
    rules.push(`line-height: ${attrs.lineHeight}`)
  }
  if (typeof attrs.indent === "number" && attrs.indent > 0) {
    rules.push(`margin-left: ${attrs.indent * 1.5}em`)
  }
  return rules.join("; ")
}

function listStyleToCss(attrs: Record<string, unknown>): string {
  if (attrs.listStyleType === "dash") {
    return "list-style-type: '-  '"
  }
  if (attrs.listStyleType === "circle") {
    return "list-style-type: circle"
  }
  if (attrs.listStyleType === "lower-alpha") {
    return "list-style-type: lower-alpha"
  }
  if (attrs.listStyleType === "decimal-nested") {
    return "list-style-type: decimal"
  }
  return ""
}

const InlineStyle = Mark.create({
  name: "inlineStyle",

  addAttributes() {
    return {
      fontSize: {
        default: null,
        parseHTML: (element: HTMLElement) => element.style.fontSize || null,
      },
      color: {
        default: null,
        parseHTML: (element: HTMLElement) => element.style.color || null,
      },
      backgroundColor: {
        default: null,
        parseHTML: (element: HTMLElement) => element.style.backgroundColor || null,
      },
    }
  },

  parseHTML() {
    return [{ tag: "span[data-td-inline-style]" }]
  },

  renderHTML({ mark }) {
    const style = inlineStyleToCss(mark.attrs)
    return ["span", style ? { "data-td-inline-style": "", style } : { "data-td-inline-style": "" }, 0]
  },
})

export const BlockStyle = Extension.create({
  name: "blockStyle",

  addGlobalAttributes() {
    return [
      {
        types: [...BLOCK_STYLE_NODE_TYPES],
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (element: HTMLElement) => element.style.textAlign || null,
            renderHTML: (attributes) => {
              const style = blockStyleToCss(attributes)
              return style ? { style } : {}
            },
          },
          lineHeight: {
            default: null,
            parseHTML: (element: HTMLElement) => element.style.lineHeight || null,
          },
          indent: {
            default: 0,
            parseHTML: (element: HTMLElement) => {
              const marginLeft = Number.parseFloat(element.style.marginLeft)
              return Number.isFinite(marginLeft) ? Math.max(0, Math.round(marginLeft / 24)) : 0
            },
          },
          canvasNodeId: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-canvas-node-id"),
            renderHTML: (attributes) => typeof attributes.canvasNodeId === "string" && attributes.canvasNodeId
              ? { "data-canvas-node-id": attributes.canvasNodeId }
              : {},
          },
          sourceBlockId: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-source-block-id"),
            renderHTML: (attributes) => typeof attributes.sourceBlockId === "string" && attributes.sourceBlockId
              ? { "data-source-block-id": attributes.sourceBlockId }
              : {},
          },
          moduleId: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-module-id"),
            renderHTML: (attributes) => typeof attributes.moduleId === "string" && attributes.moduleId
              ? { "data-module-id": attributes.moduleId }
              : {},
          },
        },
      },
      {
        types: ["bulletList", "orderedList"],
        attributes: {
          listStyleType: {
            default: null,
            parseHTML: (element: HTMLElement) => element.style.listStyleType || null,
            renderHTML: (attributes) => {
              const style = listStyleToCss(attributes)
              return style ? { style } : {}
            },
          },
        },
      },
    ]
  },
})

type SourceCanvasAttrs = {
  canvasNodeId: unknown
  sourceBlockId: unknown
  moduleId: unknown
}

function getSourceCanvasAttrs(attrs: Record<string, unknown>): SourceCanvasAttrs {
  return {
    canvasNodeId: attrs.canvasNodeId,
    sourceBlockId: attrs.sourceBlockId,
    moduleId: attrs.moduleId,
  }
}

function getSelectedSourceCanvasAttrs(editor: Editor): Array<{ pos: number; attrs: SourceCanvasAttrs }> {
  const attrsByPosition: Array<{ pos: number; attrs: SourceCanvasAttrs }> = []
  const { doc, selection } = editor.state
  const recordTextBlock = (node: ProseMirrorNode, pos: number) => {
    if (!node.isTextblock || !BLOCK_STYLE_NODE_TYPES.includes(node.type.name as (typeof BLOCK_STYLE_NODE_TYPES)[number])) return
    attrsByPosition.push({ pos, attrs: getSourceCanvasAttrs(node.attrs) })
  }

  if (selection.empty) {
    for (let depth = selection.$from.depth; depth > 0; depth -= 1) {
      const node = selection.$from.node(depth)
      if (node.isTextblock) {
        recordTextBlock(node, selection.$from.before(depth))
        break
      }
    }
    return attrsByPosition
  }

  doc.nodesBetween(selection.from, selection.to, recordTextBlock)
  return attrsByPosition
}

export function setToolbarTextBlock(editor: Editor, block: "paragraph" | "heading1" | "heading2" | "heading3") {
  const sourceAttrsByPosition = getSelectedSourceCanvasAttrs(editor)
  const chain = editor.chain().focus()

  if (block === "paragraph") chain.setParagraph()
  if (block === "heading1") chain.toggleHeading({ level: 1 })
  if (block === "heading2") chain.toggleHeading({ level: 2 })
  if (block === "heading3") chain.toggleHeading({ level: 3 })

  chain.command(({ tr }) => {
    for (const { pos, attrs } of sourceAttrsByPosition) {
      const mappedPos = tr.mapping.map(pos)
      const node = tr.doc.nodeAt(mappedPos)
      if (!node?.isTextblock || !BLOCK_STYLE_NODE_TYPES.includes(node.type.name as (typeof BLOCK_STYLE_NODE_TYPES)[number])) continue
      tr.setNodeMarkup(mappedPos, undefined, { ...node.attrs, ...attrs })
    }
    return true
  }).run()
}

const PasteMarkdown = Extension.create({
  name: "pasteMarkdown",

  addProseMirrorPlugins() {
    const { editor } = this

    return [
      new Plugin({
        props: {
          handlePaste(_view, event) {
            const text = event.clipboardData?.getData("text/plain")

            if (!text || !looksLikeMarkdown(text)) {
              return false
            }

            editor.commands.insertContent(text, { contentType: "markdown" })
            return true
          },
        },
      }),
    ]
  },
})

type ToolbarSelectProps<T extends string> = {
  ariaLabel: string
  tooltipLabel?: string
  value: T
  options: Array<{ value: T; label: string; icon?: typeof Type }>
  disabled?: boolean
  className?: string
  onChange: (value: T) => void
}

function ToolbarSelect<T extends string>({ ariaLabel, tooltipLabel, value, options, disabled = false, className = "", onChange }: ToolbarSelectProps<T>) {
  const selected = options.find((option) => option.value === value) ?? options[0]
  const SelectedIcon = selected.icon
  const button = (
    <DropdownMenuTrigger asChild>
      <Button
        type="button"
        variant="ghost"
        aria-label={ariaLabel}
        title={tooltipLabel}
        disabled={disabled}
        className={`td-toolbar-select-trigger ${className}`}
      >
        {SelectedIcon ? <SelectedIcon /> : null}
        <span>{selected.label}</span>
      </Button>
    </DropdownMenuTrigger>
  )

  return (
    <DropdownMenu>
      {tooltipLabel ? (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent>{tooltipLabel}</TooltipContent>
        </Tooltip>
      ) : button}
      <DropdownMenuContent align="start" className="td-toolbar-select-content min-w-0">
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            className="td-toolbar-select-item"
            onSelect={() => onChange(option.value)}
          >
            <span className="td-toolbar-select-check">
              {option.value === value ? "✓" : null}
            </span>
            <span>{option.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function getSelectionAncestorAttrs(editor: NonNullable<ReturnType<typeof useEditor>>, nodeTypes: readonly string[]) {
  const { $from } = editor.state.selection
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const node = $from.node(depth)
    if (nodeTypes.includes(node.type.name)) {
      return node.attrs as Record<string, unknown>
    }
  }
  return {}
}

function getEditableBlockType(editor: NonNullable<ReturnType<typeof useEditor>>): "paragraph" | "heading" | "listItem" {
  if (editor.isActive("listItem")) return "listItem"
  if (editor.isActive("heading")) return "heading"
  return "paragraph"
}

function getActiveTextAlign(editor: NonNullable<ReturnType<typeof useEditor>>): ToolbarAlignment {
  const attrs = getSelectionAncestorAttrs(editor, BLOCK_STYLE_NODE_TYPES)
  return attrs.textAlign === "center" || attrs.textAlign === "right" || attrs.textAlign === "justify" ? attrs.textAlign : "left"
}

function getActiveLineHeight(editor: NonNullable<ReturnType<typeof useEditor>>): ToolbarLineHeight {
  const attrs = getSelectionAncestorAttrs(editor, BLOCK_STYLE_NODE_TYPES)
  const value = attrs.lineHeight
  return value === "1" || value === "1.15" || value === "1.5" || value === "2" || value === "2.5" || value === "3" ? value : DEFAULT_LINE_HEIGHT
}

function getActiveIndent(editor: NonNullable<ReturnType<typeof useEditor>>): number {
  const attrs = getSelectionAncestorAttrs(editor, BLOCK_STYLE_NODE_TYPES)
  return typeof attrs.indent === "number" ? attrs.indent : 0
}

function getActiveListStyle(editor: NonNullable<ReturnType<typeof useEditor>>, type: "bulletList" | "orderedList") {
  const attrs = getSelectionAncestorAttrs(editor, [type])
  return typeof attrs.listStyleType === "string" ? attrs.listStyleType : null
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

function getSelectionAnchorModuleId(editor: Editor): string | null {
  const { $anchor } = editor.state.selection

  for (let depth = $anchor.depth; depth >= 0; depth -= 1) {
    const moduleId = $anchor.node(depth).attrs.moduleId
    if (typeof moduleId === "string" && moduleId) {
      return moduleId
    }
  }

  return null
}

function getActiveToolbarBlock(editor: NonNullable<ReturnType<typeof useEditor>>): ToolbarBlock {
  if (editor.isActive("columns")) return "columns"
  if (editor.isActive("heading", { level: 1 })) return "heading1"
  if (editor.isActive("heading", { level: 2 })) return "heading2"
  if (editor.isActive("heading", { level: 3 })) return "heading3"
  if (editor.isActive("bulletList")) return "bulletList"
  if (editor.isActive("orderedList")) return "orderedList"
  return "paragraph"
}

export const ResumeRichTextEditor = forwardRef<ResumeRichTextEditorHandle, ResumeRichTextEditorProps>(
  function ResumeRichTextEditor(
    {
      ariaLabel,
      docJson,
      onChange,
      onSelectionUpdate,
      onSourceCanvasModuleChange,
      editable = true,
      cssText = "",
      marginConfig,
      moduleOutlineVisible = false,
      onModuleOutlineVisibleChange,
    },
    ref,
  ) {
    const onChangeRef = useRef(onChange)
    onChangeRef.current = onChange
    const onSelectionUpdateRef = useRef(onSelectionUpdate)
    onSelectionUpdateRef.current = onSelectionUpdate
    const onSourceCanvasModuleChangeRef = useRef(onSourceCanvasModuleChange)
    onSourceCanvasModuleChangeRef.current = onSourceCanvasModuleChange
    const [dragHandleBlock, setDragHandleBlock] = useState<ToolbarBlock>("paragraph")
    const [dragHandleVisible, setDragHandleVisible] = useState(false)
    const latestDragHandlePointerRef = useRef<{ clientY: number } | null>(null)
    const handleRichEditorPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
      latestDragHandlePointerRef.current = { clientY: event.clientY }
      const target = event.target
      if (
        target instanceof Element
        && !target.closest(".td-editor-print-wrapper")
        && !target.closest(".td-drag-handle-shell")
      ) {
        setDragHandleVisible(false)
      }
    }, [])
    const handleRichEditorPointerLeave = useCallback(() => {
      latestDragHandlePointerRef.current = null
      setDragHandleVisible(false)
    }, [])
    const handleDragHandleNodeChange = useCallback(({ editor, node, pos }: { editor: Editor; node: ProseMirrorNode | null; pos: number }) => {
      if (!node) {
        setDragHandleVisible(false)
        return
      }
      const nodeElement = getDragHandleNodeElement(editor, pos)
      const isVisible = isPointerWithinDragHandleBlock(
        latestDragHandlePointerRef.current,
        nodeElement?.getBoundingClientRect() ?? null,
      )
      setDragHandleVisible(isVisible)
      if (isVisible) {
        setDragHandleBlock(getDragHandleBlockType(node, editor, pos))
      }
    }, [])

    const editor = useEditor({
      extensions: [
        StarterKit,
        Markdown,
        PasteMarkdown,
        InlineStyle,
        BlockStyle,
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
        onSourceCanvasModuleChangeRef.current?.(getSelectionAnchorModuleId(editor))

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
            isUnderline: editor.isActive("underline"),
            isHeading1: editor.isActive("heading", { level: 1 }),
            isHeading2: editor.isActive("heading", { level: 2 }),
            isHeading3: editor.isActive("heading", { level: 3 }),
            isBulletList: editor.isActive("bulletList"),
            isOrderedList: editor.isActive("orderedList"),
            isParagraph: editor.isActive("paragraph"),
            isColumns: editor.isActive("columns"),
            inlineColor: typeof editor.getAttributes("inlineStyle").color === "string"
              ? editor.getAttributes("inlineStyle").color
              : DEFAULT_TEXT_COLOR,
            inlineBackgroundColor: typeof editor.getAttributes("inlineStyle").backgroundColor === "string"
              ? editor.getAttributes("inlineStyle").backgroundColor
              : null,
            inlineFontSize: typeof editor.getAttributes("inlineStyle").fontSize === "string"
              ? editor.getAttributes("inlineStyle").fontSize
              : "",
            textAlign: getActiveTextAlign(editor),
            lineHeight: getActiveLineHeight(editor),
            orderedListStyle: getActiveListStyle(editor, "orderedList") === "lower-alpha"
              ? "lower-alpha"
              : getActiveListStyle(editor, "orderedList") === "decimal-nested"
                ? "decimal-nested"
                : "decimal",
            bulletListStyle: getActiveListStyle(editor, "bulletList") === "circle"
              ? "circle"
              : getActiveListStyle(editor, "bulletList") === "dash"
                ? "dash"
                : "disc",
            indent: getActiveIndent(editor),
            activeBlock: getActiveToolbarBlock(editor),
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
      setTextSelection: (selection) => {
        if (!editor || editor.isDestroyed) return
        editor.commands.setTextSelection({ from: selection.anchor, to: selection.head })
      },
      scrollToCanvasNode: (canvasNodeId, options) => {
        if (!editor || editor.isDestroyed) return
        const root = editor.view.dom

        const canvasNodes = root.querySelectorAll("[data-canvas-node-id]")
        for (const canvasNode of canvasNodes) {
          if (canvasNode instanceof HTMLElement && canvasNode.getAttribute("data-canvas-node-id") === canvasNodeId) {
            const behavior = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
            if (options?.topOffset !== undefined) {
              const viewport = canvasNode.closest(".td-source-resume-canvas-viewport")
                ?? canvasNode.closest(".td-editor-print-wrapper")
              if (!(viewport instanceof HTMLElement)) return
              const targetRect = canvasNode.getBoundingClientRect()
              const viewportRect = viewport.getBoundingClientRect()
              viewport.scrollTo({
                top: Math.max(0, viewport.scrollTop + targetRect.top - viewportRect.top - options.topOffset),
                behavior,
              })
              return
            }
            canvasNode.scrollIntoView({ behavior, block: "center" })
            return
          }
        }
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

    const canEditParagraphStyle = toolbarState.activeBlock === "paragraph"
    const canEditBlockStyle = Boolean(editor) && toolbarState.activeBlock !== "columns"
    const updateCurrentBlockStyle = (attrs: Record<string, unknown>) => {
      if (!editor) return
      editor.chain().focus().updateAttributes(getEditableBlockType(editor), attrs).run()
    }
    const increaseIndent = () => updateCurrentBlockStyle({ indent: Math.min(MAX_INDENT, toolbarState.indent + 1) })
    const decreaseIndent = () => updateCurrentBlockStyle({ indent: Math.max(0, toolbarState.indent - 1) })

    return (
      <div
        className="td-rich-editor"
        onPointerMove={handleRichEditorPointerMove}
        onPointerLeave={handleRichEditorPointerLeave}
      >
        {editable && (
          <div className="td-rich-editor-toolbar" role="toolbar" aria-label="简历格式工具栏">
            <ToolbarGroup>
              <ToolbarSelect
                ariaLabel="正文与标题"
                tooltipLabel="正文与标题"
                value={toolbarState.activeBlock}
                options={BLOCK_OPTIONS}
                disabled={!editor}
                className="td-toolbar-block-trigger"
                onChange={(block) => {
                  if (editor && (block === "paragraph" || block === "heading1" || block === "heading2" || block === "heading3")) {
                    setToolbarTextBlock(editor, block)
                  }
                }}
              />
              <ToolbarSelect
                ariaLabel="字号"
                value={toolbarState.inlineFontSize || "15px"}
                options={INLINE_FONT_SIZES.map((size) => ({ value: size, label: size }))}
                disabled={!editor || !canEditParagraphStyle}
                className="td-toolbar-font-size-trigger"
                onChange={(fontSize) => editor?.chain().focus().setMark("inlineStyle", { fontSize }).run()}
              />
              <ToolbarIconButton
                label="加粗"
                icon={Bold}
                isActive={toolbarState.isBold}
                disabled={!editor || !canEditParagraphStyle}
                onClick={() => editor?.chain().focus().toggleBold().run()}
              />
              <ToolbarIconButton
                label="斜体"
                icon={Italic}
                isActive={toolbarState.isItalic}
                disabled={!editor}
                onClick={() => editor?.chain().focus().toggleItalic().run()}
              />
            </ToolbarGroup>
            <ToolbarVerticalSeparator />
            <ToolbarGroup className="td-toolbar-color-group">
              <ColorPickerPopover
                kind="text"
                value={toolbarState.inlineColor}
                disabled={!editor}
                onChange={(color) => {
                  if (color) {
                    editor?.chain().focus().setMark("inlineStyle", { color }).run()
                  }
                }}
              />
              <ColorPickerPopover
                kind="background"
                value={toolbarState.inlineBackgroundColor}
                disabled={!editor}
                onChange={(backgroundColor) => {
                  editor?.chain().focus().setMark("inlineStyle", { backgroundColor }).run()
                }}
              />
            </ToolbarGroup>
            <ToolbarVerticalSeparator />
            <ToolbarGroup>
              <ToolbarIconButton
                label="清除局部样式"
                icon={Eraser}
                disabled={!editor}
                onClick={() => editor?.chain().focus().unsetMark("inlineStyle").run()}
              />
              <AlignmentToolbarButton
                value={toolbarState.textAlign}
                disabled={!canEditBlockStyle}
                onChange={(textAlign) => updateCurrentBlockStyle({ textAlign })}
              />
              <BulletListToolbarButton
                value={toolbarState.bulletListStyle}
                isActive={toolbarState.isBulletList}
                disabled={!editor}
                onChange={(listStyleType) => {
                  if (!toolbarState.isBulletList) editor?.chain().focus().toggleBulletList().run()
                  editor?.chain().focus().updateAttributes("bulletList", { listStyleType }).run()
                }}
              />
              <OrderedListToolbarButton
                value={toolbarState.orderedListStyle}
                isActive={toolbarState.isOrderedList}
                disabled={!editor}
                onChange={(listStyleType) => {
                  if (!toolbarState.isOrderedList) editor?.chain().focus().toggleOrderedList().run()
                  editor?.chain().focus().updateAttributes("orderedList", { listStyleType }).run()
                }}
              />
              <IndentToolbarButton disabled={!canEditBlockStyle} onIncrease={increaseIndent} onDecrease={decreaseIndent} />
              <LineHeightToolbarButton
                value={toolbarState.lineHeight}
                disabled={!canEditBlockStyle}
                onChange={(lineHeight) => updateCurrentBlockStyle({ lineHeight: lineHeight === DEFAULT_LINE_HEIGHT ? null : lineHeight })}
              />
            </ToolbarGroup>
            <ToolbarVerticalSeparator />
            <ToolbarGroup>
              <ToolbarIconButton
                label="下划线"
                icon={Underline}
                isActive={toolbarState.isUnderline}
                disabled={!editor}
                onClick={() => editor?.chain().focus().toggleMark("underline").run()}
              />
            </ToolbarGroup>
            <ToolbarVerticalSeparator />
            <ToolbarGroup>
              <DividerToolbarButton disabled={!editor} onClick={() => editor?.chain().focus().setHorizontalRule().run()} />
              <Popover>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="分栏"
                        disabled={!editor}
                        data-active={toolbarState.isColumns || undefined}
                        className="td-editor-toolbar-button"
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
            </ToolbarGroup>
            {onModuleOutlineVisibleChange && (
              <>
                <ToolbarVerticalSeparator />
                <ToolbarGroup>
                  <ToolbarIconButton
                    label="模块大纲"
                    icon={ListTree}
                    isActive={moduleOutlineVisible}
                    onClick={() => onModuleOutlineVisibleChange(!moduleOutlineVisible)}
                  />
                </ToolbarGroup>
              </>
            )}
          </div>
        )}
        <style>{cssText}</style>
        {editable && (
          <DragHandle
            editor={editor}
            className={`drag-handle td-resume-drag-handle-floating${dragHandleVisible ? "" : " td-resume-drag-handle-suppressed"}`}
            onNodeChange={handleDragHandleNodeChange}
          >
            <ResumeDragHandleChrome block={dragHandleBlock} />
          </DragHandle>
        )}
        <div className="td-editor-print-wrapper">
          <EditorContent editor={editor} className="td-rich-editor-content" />
        </div>
      </div>
    )
  },
)
