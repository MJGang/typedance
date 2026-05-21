import { List } from "lucide-react";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InspectorSection } from "../InspectorControls";
import type { BlockStyle } from "../../../style-engine/types";

type Props = { value: BlockStyle; onChange: (v: BlockStyle) => void };

const LIST_STYLE_LABELS: Record<NonNullable<BlockStyle["listStyleType"]>, string> = {
  disc: "实心圆",
  circle: "空心圆",
  square: "方块",
  decimal: "数字",
  none: "无",
};

export function ListSection({ value, onChange }: Props) {
  const currentListStyle = value.listStyleType ?? "默认";

  return (
    <InspectorSection
      value="list"
      icon={List}
      title="列表选项"
      summary={currentListStyle === "默认" ? currentListStyle : LIST_STYLE_LABELS[currentListStyle]}
    >
      <FieldGroup className="grid grid-cols-2 gap-3">
        <Field className="gap-1.5">
          <FieldLabel className="text-xs text-muted-foreground">符号样式</FieldLabel>
          <Select value={value.listStyleType} onValueChange={(v) => onChange({ ...value, listStyleType: v as BlockStyle["listStyleType"] })}>
            <SelectTrigger className="w-full justify-between"><SelectValue placeholder="默认" /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="disc">实心圆</SelectItem>
                <SelectItem value="circle">空心圆</SelectItem>
                <SelectItem value="square">方块</SelectItem>
                <SelectItem value="decimal">数字</SelectItem>
                <SelectItem value="none">无</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field className="gap-1.5">
          <FieldLabel className="text-xs text-muted-foreground">缩进</FieldLabel>
          <Input value={value.paddingLeft ?? ""} placeholder="如 20px" onChange={(e) => onChange({ ...value, paddingLeft: e.target.value || undefined })} />
        </Field>
      </FieldGroup>
    </InspectorSection>
  );
}
