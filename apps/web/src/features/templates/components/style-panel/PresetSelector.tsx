import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getPresetNames } from "../../style-engine/presets";

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
    <div className="td-preset-selector">
      <label className="text-sm">预设</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {getPresetNames().map((name) => (
            <SelectItem key={name} value={name}>{PRESET_LABELS[name] ?? name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
