import { ChevronDown, Square } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { BorderEditor } from "../controls/BorderEditor";
import type { BlockStyle } from "../../../style-engine/types";

type Props = { value: BlockStyle; onChange: (v: BlockStyle) => void };

export function BorderSection({ value, onChange }: Props) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-muted [&[data-state=open]>svg:first-child]:rotate-0">
        <ChevronDown className="size-3.5 -rotate-90 text-muted-foreground transition-transform duration-200" />
        <Square className="size-3.5 text-muted-foreground" />
        <span className="flex-1 text-left">边框</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 p-2">
        <BorderEditor value={value.borderBottom} onChange={(b) => onChange({ ...value, borderBottom: b })} />
      </CollapsibleContent>
    </Collapsible>
  );
}
