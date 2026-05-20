import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AlignLeft, AlignCenter, AlignRight } from "lucide-react";
import type { BlockStyle } from "../../../style-engine/types";

type Props = { value: BlockStyle; onChange: (v: BlockStyle) => void };

export function AlignmentSection({ value, onChange }: Props) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-muted [&[data-state=open]>svg:first-child]:rotate-0">
        <ChevronDown className="size-3.5 -rotate-90 text-muted-foreground transition-transform duration-200" />
        <AlignLeft className="size-3.5 text-muted-foreground" />
        <span className="flex-1 text-left">对齐</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="p-2">
        <ToggleGroup
          type="single"
          value={value.textAlign ?? "left"}
          onValueChange={(v) => v && onChange({ ...value, textAlign: v as BlockStyle["textAlign"] })}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <ToggleGroupItem value="left" aria-label="左对齐"><AlignLeft /></ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent>左对齐</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <ToggleGroupItem value="center" aria-label="居中对齐"><AlignCenter /></ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent>居中对齐</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <ToggleGroupItem value="right" aria-label="右对齐"><AlignRight /></ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent>右对齐</TooltipContent>
          </Tooltip>
        </ToggleGroup>
      </CollapsibleContent>
    </Collapsible>
  );
}
