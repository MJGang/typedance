import { Baseline, PaintBucket, Palette } from "lucide-react";

import { ColorPickerPopover, DEFAULT_TEXT_COLOR } from "@/components/color-picker-popover";
import { InspectorRow, InspectorRows, InspectorSection } from "../InspectorControls";
import type { BlockStyle } from "../../../style-engine/types";

type Props = {
  value: BlockStyle;
  onChange: (v: BlockStyle) => void;
  showBackground?: boolean;
};

function ColorValue({ value, fallback, noFill = false }: { value?: string; fallback: string; noFill?: boolean }) {
  const swatchColor = value ?? (noFill ? undefined : fallback);
  const noFillBackground = {
    background:
      "linear-gradient(135deg, transparent calc(50% - 1px), #ef4444 calc(50% - 1px) calc(50% + 1px), transparent calc(50% + 1px)), #fff",
  };

  return (
    <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
      <span
        className="size-5 shrink-0 rounded-md border border-border"
        style={swatchColor ? { backgroundColor: swatchColor } : undefined}
      >
        {noFill && !value ? (
          <span className="block size-full rounded-md" style={noFillBackground} />
        ) : null}
      </span>
      <span className="max-w-20 truncate">{value ?? fallback}</span>
    </span>
  );
}

export function ColorSection({ value, onChange, showBackground = true }: Props) {
  return (
    <InspectorSection value="color" icon={Palette} title="颜色与背景" summary={value.color || value.backgroundColor ? "已设置" : "默认"}>
      <InspectorRows>
        <InspectorRow label="文字" icon={Baseline}>
          <ColorValue value={value.color} fallback={DEFAULT_TEXT_COLOR} />
          <ColorPickerPopover
            kind="text"
            value={value.color}
            ariaLabel="文字颜色"
            onChange={(color) => onChange({ ...value, color: color ?? undefined })}
          />
        </InspectorRow>
        {showBackground ? (
          <InspectorRow label="背景" icon={PaintBucket}>
            <ColorValue value={value.backgroundColor} fallback="无" noFill />
            <ColorPickerPopover
              kind="background"
              value={value.backgroundColor}
              ariaLabel="背景颜色"
              onChange={(color) => onChange({ ...value, backgroundColor: color ?? undefined })}
            />
          </InspectorRow>
        ) : null}
      </InspectorRows>
    </InspectorSection>
  );
}
