import { useState, type ReactNode } from "react"
import { toast } from "sonner"
import { useEditorReferences } from "./EditorReferences"
import { ReferenceSelectionPopover } from "./ReferenceSelectionPopover"

export function MessageReferenceSelection({ messageId, children }: { messageId: string; children: ReactNode }) {
  const context = useEditorReferences()
  const [selection, setSelection] = useState<{ text: string; rect: DOMRect } | null>(null)
  const capture = (root: HTMLDivElement) => {
    if (!context) return
    const selected = window.getSelection()
    if (!selected || selected.isCollapsed || selected.rangeCount === 0) return
    const range = selected.getRangeAt(0)
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return
    const text = range.toString()
    if (text.trim()) setSelection({ text, rect: range.getBoundingClientRect() })
  }
  return <>
    <div onMouseUp={(event) => capture(event.currentTarget)} onKeyUp={(event) => { if (event.key === "Shift") capture(event.currentTarget) }}>{children}</div>
    {context && selection ? <ReferenceSelectionPopover key={selection.text} rect={selection.rect} onClose={() => setSelection(null)} onAdd={(comment) => {
      if (selection.text.length > 4000) { toast.error("每处引用最多 4000 字，请缩小选择范围。"); return }
      context.add({ text: selection.text, label: "AI 回复", comment, source: { kind: "message", message_id: messageId } })
      setSelection(null)
    }} /> : null}
  </>
}
