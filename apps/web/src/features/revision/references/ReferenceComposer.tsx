import { useState } from "react"
import { ChevronDown, MessageSquareQuote, Pencil, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import type { EditorReference } from "@typedance/contracts"
import { useEditorReferences } from "./EditorReferences"

export function ReferenceComposer() {
  const context = useEditorReferences()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<{ id: string; comment: string } | null>(null)
  if (!context || context.pending.length === 0) return null
  return (
    <div className="flex items-center gap-1 px-3 pt-3">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="secondary" size="xs" aria-label={`查看 ${context.pending.length} 处引用`}>
            <MessageSquareQuote data-icon="inline-start" />{context.pending.length} 处引用<ChevronDown data-icon="inline-end" />
          </Button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="max-h-[min(30rem,var(--radix-popover-content-available-height))] w-[min(26rem,calc(100vw-2rem))] gap-0 overflow-y-auto p-0"
          onCloseAutoFocus={(event) => event.preventDefault()}>
          <PopoverHeader className="border-b border-border px-4 py-3"><PopoverTitle>引用片段 · {context.pending.length}</PopoverTitle></PopoverHeader>
          <ol className="flex flex-col">
            {context.pending.map(({ reference, changed }) => (
              <li key={reference.id} className="flex flex-col gap-3 border-b border-border p-4 last:border-b-0">
                <div className="flex items-start gap-1">
                  <Button type="button" variant="ghost" size="sm" className="mr-auto h-auto min-w-0 whitespace-normal px-0 text-left" onClick={() => context.locate(reference)}>
                    {reference.ordinal} · {reference.label}
                  </Button>
                  <Button type="button" variant="ghost" size="icon-xs" aria-label={`编辑引用 ${reference.ordinal} 的修改要求`} onClick={() => setEditing({ id: reference.id, comment: reference.comment })}><Pencil /></Button>
                  <Button type="button" variant="ghost" size="icon-xs" aria-label={`删除引用 ${reference.ordinal}`} onClick={() => { context.remove(reference.id); if (editing?.id === reference.id) setEditing(null) }}><Trash2 /></Button>
                </div>
                <div className="flex flex-col gap-1">
                  <p className="text-xs text-muted-foreground">所选文本{reference.source.kind === "message" ? " · AI 回复" : ""}</p>
                  <p className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6">{reference.text}</p>
                </div>
                {editing?.id === reference.id ? (
                  <Field>
                    <FieldLabel htmlFor={`reference-comment-${reference.id}`}>修改要求</FieldLabel>
                    <Textarea id={`reference-comment-${reference.id}`} aria-label={`引用 ${reference.ordinal} 的修改要求`} autoFocus rows={2} maxLength={2000}
                      value={editing.comment} onChange={(event) => setEditing({ ...editing, comment: event.target.value })} />
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="ghost" size="xs" onClick={() => setEditing(null)}>取消</Button>
                      <Button type="button" size="xs" onClick={() => { context.editComment(reference.id, editing.comment); setEditing(null) }}>保存要求</Button>
                    </div>
                  </Field>
                ) : (
                  <div className="flex flex-col gap-1">
                    <p className="text-xs text-muted-foreground">修改要求</p>
                    <p className="whitespace-pre-wrap break-words text-sm leading-6">{reference.comment || "按本次消息处理"}</p>
                  </div>
                )}
                {changed ? <p role="status" className="text-xs text-destructive">原文已修改，请删除此引用后重新选择。</p> : null}
              </li>
            ))}
          </ol>
        </PopoverContent>
      </Popover>
      <Button type="button" variant="ghost" size="icon-xs" aria-label="清除全部引用" onClick={() => { context.clear(); setOpen(false) }}><X /></Button>
    </div>
  )
}

export function MessageReferences({ references }: { references?: EditorReference[] }) {
  const context = useEditorReferences()
  if (!references?.length) return null
  return <div className="mb-3 flex flex-col gap-3" data-testid="message-references">
    {references.map((reference) => <blockquote key={reference.id} className="flex flex-col gap-1 border-l-2 border-border pl-3">
      <Button type="button" variant="link" size="xs" className="h-auto justify-start whitespace-normal p-0 text-left" disabled={!context} onClick={() => context?.locate(reference)}>
        引用 {reference.ordinal} · {reference.label}
      </Button>
      <p className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{reference.text}</p>
      {reference.comment ? <p className="whitespace-pre-wrap break-words text-xs leading-5"><span className="text-muted-foreground">修改要求：</span>{reference.comment}</p> : null}
    </blockquote>)}
  </div>
}
