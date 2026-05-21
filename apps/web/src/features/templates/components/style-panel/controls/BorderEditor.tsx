import { Palette, Ruler, Square } from "lucide-react";

import { ColorPickerPopover } from "@/components/color-picker-popover";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InspectorRow, InspectorRows } from "../InspectorControls";
import type { BlockStyle } from "../../../style-engine/types";

type BorderEditorProps = {
  value: BlockStyle["borderBottom"];
  onChange: (border: BlockStyle["borderBottom"]) => void;
};

const BORDER_STYLE_LABELS: Record<"none" | "solid" | "double", string> = {
  none: "无",
  solid: "实线",
  double: "双线",
};

function BorderColorValue({ value, disabled }: { value?: string; disabled: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
      <span
        className="size-5 shrink-0 rounded-md border border-border"
        style={value && !disabled ? { backgroundColor: value } : undefined}
      />
      <span className="max-w-20 truncate">{disabled ? "未启用" : value ?? "默认"}</span>
    </span>
  );
}

export function BorderEditor({ value, onChange }: BorderEditorProps) {
  const style = value?.style ?? "none";
  const borderEnabled = style !== "none";

  const updateBorder = (next: Partial<NonNullable<BlockStyle["borderBottom"]>>) => {
    onChange({ ...value, style, ...next });
  };

  return (
    <InspectorRows>
      <InspectorRow label="样式" icon={Square}>
        <Select
          value={style}
          onValueChange={(nextStyle: "none" | "solid" | "double") => {
            onChange(nextStyle === "none" ? undefined : { ...value, style: nextStyle });
          }}
        >
          <SelectTrigger size="sm" className="w-28 justify-between text-xs">
            <SelectValue placeholder={BORDER_STYLE_LABELS[style]} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none" className="text-xs">无</SelectItem>
            <SelectItem value="solid" className="text-xs">实线</SelectItem>
            <SelectItem value="double" className="text-xs">双线</SelectItem>
          </SelectContent>
        </Select>
      </InspectorRow>
      <InspectorRow label="粗细" icon={Ruler}>
        <Input
          disabled={!borderEnabled}
          value={value?.width ?? ""}
          placeholder="1px"
          className="h-8 max-w-28 text-right"
          onChange={(event) => updateBorder({ width: event.target.value || undefined })}
        />
      </InspectorRow>
      <InspectorRow label="颜色" icon={Palette}>
        <BorderColorValue value={value?.color} disabled={!borderEnabled} />
        <ColorPickerPopover
          kind="text"
          value={value?.color}
          disabled={!borderEnabled}
          icon={Square}
          ariaLabel="边框颜色"
          onChange={(color) => updateBorder({ color: color ?? undefined })}
        />
      </InspectorRow>
    </InspectorRows>
  );
}
