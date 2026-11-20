import { LockKeyhole } from "lucide-react"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

const itemClassName = "h-6 min-w-10 px-2.5 text-xs data-[state=on]:bg-accent data-[state=on]:text-accent-foreground"

export function CanvasModeSwitch({ readOnly, previewOpen, onChange }: {
  readOnly: boolean
  previewOpen: boolean
  onChange: (readOnly: boolean) => void
}) {
  const edit = <ToggleGroupItem value="edit" disabled={previewOpen} className={itemClassName}>编辑</ToggleGroupItem>
  return (
    <ToggleGroup
      type="single"
      size="sm"
      aria-label="文档模式"
      className="ml-1 shrink-0 gap-0 rounded-full border border-border bg-muted/40"
      value={readOnly ? "read-only" : "edit"}
      onValueChange={(mode) => { if (mode && !previewOpen) onChange(mode === "read-only") }}
    >
      {previewOpen ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0}>{edit}</span>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>预览场景下为只读模式，不可编辑</TooltipContent>
        </Tooltip>
      ) : edit}
      <ToggleGroupItem value="read-only" className={itemClassName}>
        <LockKeyhole data-icon="inline-start" className="size-3" aria-hidden="true" />
        只读
      </ToggleGroupItem>
    </ToggleGroup>
  )
}
