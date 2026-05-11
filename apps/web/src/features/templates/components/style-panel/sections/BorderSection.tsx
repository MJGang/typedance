import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { BorderEditor } from "../controls/BorderEditor";
import type { BlockStyle } from "../../../style-engine/types";

type Props = { value: BlockStyle; onChange: (v: BlockStyle) => void };

export function BorderSection({ value, onChange }: Props) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="td-section-trigger">边框</CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 p-2">
        <BorderEditor value={value.borderBottom} onChange={(b) => onChange({ ...value, borderBottom: b })} />
      </CollapsibleContent>
    </Collapsible>
  );
}
