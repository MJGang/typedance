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
    <div className="td-border-editor space-y-2">
      <Select value={style} onValueChange={(v: "none" | "solid" | "double") => onChange({ ...value, style: v })}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">无</SelectItem>
          <SelectItem value="solid">实线</SelectItem>
          <SelectItem value="double">双线</SelectItem>
        </SelectContent>
      </Select>
      {style !== "none" && (
        <div className="flex gap-2">
          <Input
            placeholder="粗细"
            value={value?.width ?? ""}
            onChange={(e) => onChange({ ...value, style, width: e.target.value })}
            className="w-20"
          />
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
