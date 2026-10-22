import { useState } from "react"
import { ArrowUpRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"

const quickActions = [
  { label: "精简", comment: "精简表达，保留所有事实。" },
  { label: "改写", comment: "改善表达，让语句更清楚自然，不增加新事实。" },
  { label: "检查", comment: "检查错别字和语句是否通顺，说明发现的问题。" },
]

export function ReferenceSelectionPopover({ rect, onAdd, onClose }: {
  rect: DOMRect
  onAdd: (comment: string) => void
  onClose: () => void
}) {
  const [comment, setComment] = useState("")
  return (
    <Popover open onOpenChange={(open) => { if (!open) onClose() }}>
      <PopoverAnchor asChild>
        <span aria-hidden="true" className="pointer-events-none fixed size-px" style={{ left: rect.left, top: rect.bottom }} />
      </PopoverAnchor>
      <PopoverContent
        aria-label="引用选中文字"
        data-reference-popover="true"
        side="bottom"
        align="start"
        collisionPadding={12}
        className="w-80 gap-2 p-3"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <Field>
          <FieldLabel htmlFor="reference-selection-comment" className="sr-only">修改要求</FieldLabel>
          <Input id="reference-selection-comment" aria-label="为选中文字添加修改要求" placeholder="添加修改要求…" value={comment} maxLength={2000}
            onChange={(event) => setComment(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); onAdd(comment) } }} />
        </Field>
        <div className="flex items-center gap-1">
          {quickActions.map((action) => <Button key={action.label} type="button" variant="outline" size="xs" onClick={() => onAdd(comment.trim() || action.comment)}>{action.label}</Button>)}
          <Button type="button" variant="ghost" size="xs" className="ml-auto" onClick={() => onAdd(comment)}>
            <ArrowUpRight data-icon="inline-start" />添加为引用
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
