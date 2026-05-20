import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ColorPicker } from "./ColorPicker";
import type { BlockStyle } from "../../../style-engine/types";

type BorderEditorProps = {
  value: BlockStyle["borderBottom"];
  onChange: (border: BlockStyle["borderBottom"]) => void;
};

export function BorderEditor({ value, onChange }: BorderEditorProps) {
  const style = value?.style ?? "none";
  return (
    <div className="flex flex-col gap-2">
      <Select value={style} onValueChange={(v: "none" | "solid" | "double") => onChange({ ...value, style: v })}>
        <SelectTrigger size="sm" className="text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none" className="text-xs">无</SelectItem>
          <SelectItem value="solid" className="text-xs">实线</SelectItem>
          <SelectItem value="double" className="text-xs">双线</SelectItem>
        </SelectContent>
      </Select>
      {style !== "none" && (
        <div className="flex items-center gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">粗细</label>
            <Input
              placeholder="粗细"
              value={value?.width ?? ""}
              onChange={(e) => onChange({ ...value, style, width: e.target.value })}
              className="h-8 w-20 text-xs"
            />
          </div>
          <ColorPicker
            value={value?.color ?? "#000000"}
            onChange={(c) => onChange({ ...value, style, color: c })}
            label="边框色"
          />
        </div>
      )}
    </div>
  );
}
