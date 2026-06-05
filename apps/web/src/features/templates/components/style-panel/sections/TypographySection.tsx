import { Type } from "lucide-react";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InspectorSection } from "../InspectorControls";
import type { BlockStyle } from "../../../style-engine/types";
import { COMMON_FONTS } from "../../../style-engine/fonts";

type Props = { value: BlockStyle; onChange: (v: BlockStyle) => void };

const DEFAULT_VALUE = "__default";
const FONT_SIZE_OPTIONS = ["10px", "11px", "12px", "13px", "14px", "15px", "16px", "18px", "19px", "20px", "24px", "28px", "32px", "34px"];
const LINE_HEIGHT_OPTIONS = ["1", "1.15", "1.3", "1.5", "1.62", "1.75", "2", "2.5"];
const FONT_WEIGHT_OPTIONS: Array<{ value: "400" | "500" | "600" | "700"; label: string }> = [
  { value: "400", label: "常规" },
  { value: "500", label: "中粗" },
  { value: "600", label: "半粗" },
  { value: "700", label: "粗体" },
];

export function TypographySection({ value, onChange }: Props) {
  return (
    <InspectorSection value="typography" icon={Type} title="排版" summary={value.fontSize ?? "默认"}>
      <FieldGroup className="gap-3">
        <Field className="gap-1.5">
          <FieldLabel className="text-xs text-muted-foreground">字体</FieldLabel>
          <Select
            value={value.fontFamily ?? DEFAULT_VALUE}
            onValueChange={(v) => onChange({ ...value, fontFamily: v === DEFAULT_VALUE ? undefined : v })}
          >
            <SelectTrigger className="w-full justify-between">
              <SelectValue placeholder="默认" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={DEFAULT_VALUE}>默认</SelectItem>
                {COMMON_FONTS.map((font) => (
                  <SelectItem key={font.value} value={font.value}>{font.label["zh-CN"]}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>

        <FieldGroup className="grid grid-cols-2 gap-3">
          <Field className="gap-1.5">
            <FieldLabel className="text-xs text-muted-foreground">字号</FieldLabel>
            <Select
              value={value.fontSize ?? DEFAULT_VALUE}
              onValueChange={(v) => onChange({ ...value, fontSize: v === DEFAULT_VALUE ? undefined : v })}
            >
              <SelectTrigger size="sm" className="w-full justify-between">
                <SelectValue placeholder="默认" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={DEFAULT_VALUE}>默认</SelectItem>
                  {FONT_SIZE_OPTIONS.map((size) => (
                    <SelectItem key={size} value={size}>{size}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          <Field className="gap-1.5">
            <FieldLabel className="text-xs text-muted-foreground">字重</FieldLabel>
            <Select
              value={value.fontWeight ? String(value.fontWeight) : DEFAULT_VALUE}
              onValueChange={(v) => onChange({ ...value, fontWeight: v === DEFAULT_VALUE ? undefined : Number(v) as 400 | 500 | 600 | 700 })}
            >
              <SelectTrigger size="sm" className="w-full justify-between">
                <SelectValue placeholder="默认" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={DEFAULT_VALUE}>默认</SelectItem>
                  {FONT_WEIGHT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          <Field className="gap-1.5">
            <FieldLabel className="text-xs text-muted-foreground">行高</FieldLabel>
            <Select
              value={value.lineHeight ? String(value.lineHeight) : DEFAULT_VALUE}
              onValueChange={(v) => onChange({ ...value, lineHeight: v === DEFAULT_VALUE ? undefined : Number(v) })}
            >
              <SelectTrigger size="sm" className="w-full justify-between">
                <SelectValue placeholder="默认" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={DEFAULT_VALUE}>默认</SelectItem>
                  {LINE_HEIGHT_OPTIONS.map((lineHeight) => (
                    <SelectItem key={lineHeight} value={lineHeight}>{lineHeight}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          <Field className="gap-1.5">
            <FieldLabel className="text-xs text-muted-foreground">字间距</FieldLabel>
            <Input
              value={value.letterSpacing ?? ""}
              placeholder="如 0.5px"
              onChange={(e) => onChange({ ...value, letterSpacing: e.target.value || undefined })}
            />
          </Field>
        </FieldGroup>
      </FieldGroup>
    </InspectorSection>
  );
}
