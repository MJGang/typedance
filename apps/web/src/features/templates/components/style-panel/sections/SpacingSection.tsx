import { ChevronDown, MoveVertical } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import type { BlockStyle } from "../../../style-engine/types";

type Props = { value: BlockStyle; onChange: (v: BlockStyle) => void };

export function SpacingSection({ value, onChange }: Props) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-muted [&[data-state=open]>svg:first-child]:rotate-0">
        <ChevronDown className="size-3.5 -rotate-90 text-muted-foreground transition-transform duration-200" />
        <MoveVertical className="size-3.5 text-muted-foreground" />
        <span className="flex-1 text-left">间距</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 p-2">
        <div className="flex gap-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">上边距</label>
            <Input value={value.marginTop ?? ""} placeholder="如 8px" onChange={(e) => onChange({ ...value, marginTop: e.target.value })} />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">下边距</label>
            <Input value={value.marginBottom ?? ""} placeholder="如 8px" onChange={(e) => onChange({ ...value, marginBottom: e.target.value })} />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
