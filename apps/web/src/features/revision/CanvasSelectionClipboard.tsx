import { useEffect, useState, type ReactElement, type RefObject } from "react"
import { Copy } from "lucide-react"
import { toast } from "sonner"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuShortcut, ContextMenuTrigger } from "@/components/ui/context-menu"

function canvasSelectionText(viewport: HTMLDivElement | null): string {
  const selection = viewport?.ownerDocument.getSelection()
  if (!selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode) return ""
  const anchor = selection.anchorNode instanceof Element ? selection.anchorNode : selection.anchorNode.parentElement
  const editor = anchor?.closest('[contenteditable="false"].td-rich-editor-prosemirror')
  if (!editor || editor.closest("[inert]") || !viewport?.contains(editor) || !editor.contains(selection.focusNode)) return ""
  return selection.toString()
}

export function CanvasSelectionClipboard({ viewport, readOnly, children }: {
  viewport: RefObject<HTMLDivElement | null>
  readOnly: boolean
  children: ReactElement
}) {
  const [menuText, setMenuText] = useState("")

  useEffect(() => {
    if (!readOnly) return
    const onCopy = (event: ClipboardEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('input, textarea, [contenteditable="true"]')) return
      const text = canvasSelectionText(viewport.current)
      if (!text || !event.clipboardData) return
      event.clipboardData.setData("text/plain", text)
      event.preventDefault()
      event.stopPropagation()
    }
    document.addEventListener("copy", onCopy, true)
    return () => document.removeEventListener("copy", onCopy, true)
  }, [readOnly, viewport])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(menuText)
    } catch {
      toast.error("复制失败，请稍后重试")
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild className="select-auto" disabled={!readOnly} onContextMenu={() => setMenuText(canvasSelectionText(viewport.current))}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem disabled={!readOnly || !menuText} onSelect={() => void copy()}>
          <Copy />
          复制
          <ContextMenuShortcut>Ctrl+C</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
