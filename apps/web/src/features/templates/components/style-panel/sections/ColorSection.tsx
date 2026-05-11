import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ColorPicker } from "../controls/ColorPicker";
import type { BlockStyle } from "../../../style-engine/types";

type Props = { value: BlockStyle; onChange: (v: BlockStyle) => void };

export function ColorSection({ value, onChange }: Props) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="td-section-trigger">颜色与背景</CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 p-2">
        <ColorPicker value={value.color} onChange={(c) => onChange({ ...value, color: c })} label="文字色" />
        <ColorPicker value={value.backgroundColor} onChange={(c) => onChange({ ...value, backgroundColor: c })} label="背景色" />
      </CollapsibleContent>
    </Collapsible>
  );
}
