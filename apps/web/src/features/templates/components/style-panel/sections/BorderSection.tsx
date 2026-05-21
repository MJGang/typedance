import { Square } from "lucide-react";

import { InspectorSection } from "../InspectorControls";
import { BorderEditor } from "../controls/BorderEditor";
import type { BlockStyle } from "../../../style-engine/types";

type Props = { value: BlockStyle; onChange: (v: BlockStyle) => void };

const BORDER_STYLE_SUMMARY: Record<"none" | "solid" | "double", string> = {
  none: "无",
  solid: "实线",
  double: "双线",
};

export function BorderSection({ value, onChange }: Props) {
  const borderStyle = value.borderBottom?.style ?? "none";

  return (
    <InspectorSection value="border" icon={Square} title="边框" summary={BORDER_STYLE_SUMMARY[borderStyle]}>
      <BorderEditor value={value.borderBottom} onChange={(borderBottom) => onChange({ ...value, borderBottom })} />
    </InspectorSection>
  );
}
