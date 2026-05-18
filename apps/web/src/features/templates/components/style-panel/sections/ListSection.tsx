import { ChevronDown, List } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import type { BlockStyle } from "../../../style-engine/types";

type Props = { value: BlockStyle; onChange: (v: BlockStyle) => void };

export function ListSection({ value, onChange }: Props) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-muted [&[data-state=open]>svg:first-child]:rotate-0">
        <ChevronDown className="size-3.5 -rotate-90 text-muted-foreground transition-transform duration-200" />
        <List className="size-3.5 text-muted-foreground" />
        <span className="flex-1 text-left">列表选项</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 p-2">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">符号样式</label>
          <Select value={value.listStyleType} onValueChange={(v) => onChange({ ...value, listStyleType: v as BlockStyle["listStyleType"] })}>
            <SelectTrigger><SelectValue placeholder="默认" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="disc">实心圆</SelectItem>
              <SelectItem value="circle">空心圆</SelectItem>
              <SelectItem value="square">方块</SelectItem>
              <SelectItem value="decimal">数字</SelectItem>
              <SelectItem value="none">无</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">缩进</label>
          <Input value={value.paddingLeft ?? ""} placeholder="如 20px" onChange={(e) => onChange({ ...value, paddingLeft: e.target.value })} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
