import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AlignLeft, AlignCenter, AlignRight } from "lucide-react";
import { InspectorRow, InspectorRows, InspectorSection } from "../InspectorControls";
import type { BlockStyle } from "../../../style-engine/types";

type Props = { value: BlockStyle; onChange: (v: BlockStyle) => void };

const ALIGN_LABELS: Record<NonNullable<BlockStyle["textAlign"]>, string> = {
  left: "左对齐",
  center: "居中",
  right: "右对齐",
};

export function AlignmentSection({ value, onChange }: Props) {
  const currentAlign = value.textAlign ?? "left";

  return (
    <InspectorSection value="alignment" icon={AlignLeft} title="对齐" summary={ALIGN_LABELS[currentAlign]}>
      <InspectorRows>
        <InspectorRow label="文本" controlClassName="justify-end">
          <ToggleGroup
            type="single"
            value={currentAlign}
            onValueChange={(v) => v && onChange({ ...value, textAlign: v as BlockStyle["textAlign"] })}
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="文本对齐"
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <ToggleGroupItem value="left" aria-label="左对齐" className="w-10 px-0"><AlignLeft /></ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>左对齐</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <ToggleGroupItem value="center" aria-label="居中对齐" className="w-10 px-0"><AlignCenter /></ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>居中对齐</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <ToggleGroupItem value="right" aria-label="右对齐" className="w-10 px-0"><AlignRight /></ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>右对齐</TooltipContent>
            </Tooltip>
          </ToggleGroup>
        </InspectorRow>
      </InspectorRows>
    </InspectorSection>
  );
}
