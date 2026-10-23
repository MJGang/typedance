import { FileText, X } from "lucide-react"
import type { HarnessAttachment } from "@typedance/contracts"
import { Button } from "@/components/ui/button"

export function ChatAttachments({ attachments, onRemove, disabled }: { attachments: HarnessAttachment[]; onRemove?: (id: string) => void; disabled?: boolean }) {
  if (!attachments.length) return null
  return <div className="flex flex-wrap gap-2" aria-label="聊天附件">
    {attachments.map((attachment) => <div key={attachment.id} className="group relative flex h-24 w-28 flex-col overflow-hidden rounded-xl border border-border bg-muted/30" title={attachment.name}>
      {attachment.content.type === "image"
        ? <img src={attachment.content.image_url} alt={attachment.name} className="min-h-0 flex-1 object-cover" />
        : <div className="flex min-h-0 flex-1 items-center justify-center bg-muted/60"><FileText className="size-6 text-muted-foreground" /></div>}
      <span className="truncate px-2 py-1 text-[11px] leading-4">{attachment.name}</span>
      {onRemove ? <Button type="button" variant="secondary" size="icon-xs" disabled={disabled} aria-label={`移除附件 ${attachment.name}`} className="absolute right-1 top-1 size-5 rounded-full shadow-sm" onClick={() => onRemove(attachment.id)}><X /></Button> : null}
    </div>)}
  </div>
}
