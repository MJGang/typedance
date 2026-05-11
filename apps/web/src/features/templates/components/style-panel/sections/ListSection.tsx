import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import type { BlockStyle } from "../../../style-engine/types";

type Props = { value: BlockStyle; onChange: (v: BlockStyle) => void };

export function ListSection({ value, onChange }: Props) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="td-section-trigger">列表选项</CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 p-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs">符号样式</label>
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
        <div className="flex flex-col gap-1">
          <label className="text-xs">缩进</label>
          <Input value={value.paddingLeft ?? ""} placeholder="如 20pt" onChange={(e) => onChange({ ...value, paddingLeft: e.target.value })} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
