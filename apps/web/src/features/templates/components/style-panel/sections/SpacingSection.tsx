import { ArrowDownToLine, ArrowUpToLine, MoveVertical } from "lucide-react";

import { Input } from "@/components/ui/input";
import { InspectorRow, InspectorRows, InspectorSection } from "../InspectorControls";
import type { BlockStyle } from "../../../style-engine/types";

type Props = { value: BlockStyle; onChange: (v: BlockStyle) => void };

export function SpacingSection({ value, onChange }: Props) {
  const summary = value.marginTop || value.marginBottom ? `${value.marginTop ?? "0"} / ${value.marginBottom ?? "0"}` : "默认";

  return (
    <InspectorSection value="spacing" icon={MoveVertical} title="间距" summary={summary}>
      <InspectorRows>
        <InspectorRow label="上方" icon={ArrowUpToLine}>
          <Input
            value={value.marginTop ?? ""}
            placeholder="如 8px"
            className="h-8 max-w-32 text-right"
            onChange={(event) => onChange({ ...value, marginTop: event.target.value || undefined })}
          />
        </InspectorRow>
        <InspectorRow label="下方" icon={ArrowDownToLine}>
          <Input
            value={value.marginBottom ?? ""}
            placeholder="如 8px"
            className="h-8 max-w-32 text-right"
            onChange={(event) => onChange({ ...value, marginBottom: event.target.value || undefined })}
          />
        </InspectorRow>
      </InspectorRows>
    </InspectorSection>
  );
}
