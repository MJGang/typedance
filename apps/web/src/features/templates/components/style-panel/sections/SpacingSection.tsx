import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import type { BlockStyle } from "../../../style-engine/types";

type Props = { value: BlockStyle; onChange: (v: BlockStyle) => void };

export function SpacingSection({ value, onChange }: Props) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="td-section-trigger">间距</CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 p-2">
        <div className="flex gap-2">
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-xs">上边距</label>
            <Input value={value.marginTop ?? ""} placeholder="如 8pt" onChange={(e) => onChange({ ...value, marginTop: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-xs">下边距</label>
            <Input value={value.marginBottom ?? ""} placeholder="如 8pt" onChange={(e) => onChange({ ...value, marginBottom: e.target.value })} />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
