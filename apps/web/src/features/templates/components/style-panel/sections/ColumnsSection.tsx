import { ChevronDown, Columns3 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { ColumnsCount, ColumnsGap } from "@typedance/tiptap-layout"

type Props = {
  count: ColumnsCount
  gap: ColumnsGap
  onCountChange: (count: ColumnsCount) => void
  onGapChange: (gap: ColumnsGap) => void
  onUnsetColumns: () => void
}

const gapLabels: Record<ColumnsGap, string> = {
  compact: "紧凑",
  default: "默认",
  wide: "宽松",
}

export function ColumnsSection({ count, gap, onCountChange, onGapChange, onUnsetColumns }: Props) {
  return (
    <Collapsible defaultOpen>
      <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-muted [&[data-state=open]>svg:first-child]:rotate-0">
        <ChevronDown className="size-3.5 -rotate-90 text-muted-foreground transition-transform duration-200" />
        <Columns3 className="size-3.5 text-muted-foreground" />
        <span className="flex-1 text-left">当前分栏</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-3 p-2">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">栏数</label>
          <ToggleGroup
            type="single"
            value={String(count)}
            onValueChange={(value) => {
              if (!value) return
              onCountChange(Number(value) as ColumnsCount)
            }}
            className="grid grid-cols-3"
          >
            {([2, 3, 4, 5, 6] as const).map((value) => (
              <ToggleGroupItem key={value} value={String(value)}>{value} 栏</ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">栏间距</label>
          <ToggleGroup
            type="single"
            value={gap}
            onValueChange={(value) => {
              if (!value) return
              onGapChange(value as ColumnsGap)
            }}
            className="grid grid-cols-3"
          >
            {Object.entries(gapLabels).map(([value, label]) => (
              <ToggleGroupItem key={value} value={value}>
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <Button type="button" variant="outline" size="sm" onClick={onUnsetColumns}>
          取消分栏
        </Button>
      </CollapsibleContent>
    </Collapsible>
  )
}
