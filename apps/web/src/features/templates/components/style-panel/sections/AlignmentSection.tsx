import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AlignLeft, AlignCenter, AlignRight } from "lucide-react";
import type { BlockStyle } from "../../../style-engine/types";

type Props = { value: BlockStyle; onChange: (v: BlockStyle) => void };

export function AlignmentSection({ value, onChange }: Props) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="td-section-trigger">对齐</CollapsibleTrigger>
      <CollapsibleContent className="p-2">
        <ToggleGroup
          type="single"
          value={value.textAlign ?? "left"}
          onValueChange={(v) => v && onChange({ ...value, textAlign: v as BlockStyle["textAlign"] })}
        >
          <ToggleGroupItem value="left"><AlignLeft /></ToggleGroupItem>
          <ToggleGroupItem value="center"><AlignCenter /></ToggleGroupItem>
          <ToggleGroupItem value="right"><AlignRight /></ToggleGroupItem>
        </ToggleGroup>
      </CollapsibleContent>
    </Collapsible>
  );
}
