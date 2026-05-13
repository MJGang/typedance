import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getPresetNames } from "../../style-engine/presets";
import { Paintbrush } from "lucide-react";

type PresetSelectorProps = {
  value: string;
  onChange: (preset: string) => void;
};

const PRESET_LABELS: Record<string, string> = {
  classic: "经典",
  modern: "现代",
  clean: "简洁",
};

export function PresetSelector({ value, onChange }: PresetSelectorProps) {
  return (
    <div className="flex items-center gap-2">
      <Paintbrush className="size-3.5 text-muted-foreground shrink-0" />
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="选择预设" /></SelectTrigger>
        <SelectContent>
          {getPresetNames().map((name) => (
            <SelectItem key={name} value={name} className="text-xs">{PRESET_LABELS[name] ?? name}</SelectItem>
          ))}
          <SelectItem value="custom" className="text-xs">自定义</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
