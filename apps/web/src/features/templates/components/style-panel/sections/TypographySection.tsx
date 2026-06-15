import { ArrowDown, ArrowUp, ChevronDown, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InspectorSection } from "../InspectorControls";
import type { BlockStyle } from "../../../style-engine/types";
import {
  COMMON_FONTS,
  buildFontFamilyStack,
  moveFontFamilySelection,
  parseFontFamilySelection,
} from "../../../style-engine/fonts";

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
  const selectedFonts = parseFontFamilySelection(value.fontFamily);
  const selectedFontLabels = selectedFonts
    .map((fontValue) => COMMON_FONTS.find((font) => font.value === fontValue)?.label["zh-CN"])
    .filter(Boolean);
  const fontSummary = selectedFontLabels.length > 0 ? selectedFontLabels.join(" / ") : "默认";

  const commitFontSelection = (nextSelectedFonts: string[]) => {
    onChange({ ...value, fontFamily: buildFontFamilyStack(nextSelectedFonts) });
  };

  const handleFontToggle = (fontValue: string, checked: boolean) => {
    if (checked) {
      commitFontSelection(selectedFonts.includes(fontValue) ? selectedFonts : [...selectedFonts, fontValue]);
      return;
    }
    commitFontSelection(selectedFonts.filter((selectedFont) => selectedFont !== fontValue));
  };

  const handleFontMove = (fontValue: string, direction: -1 | 1) => {
    commitFontSelection(moveFontFamilySelection(selectedFonts, fontValue, direction));
  };

  return (
    <InspectorSection value="typography" icon={Type} title="排版" summary={value.fontSize ?? "默认"}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <FieldLabel className="text-xs text-muted-foreground">字体</FieldLabel>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="w-full justify-between px-3 font-normal"
                aria-label="字体"
              >
                <span className="min-w-0 truncate text-left">{fontSummary}</span>
                <ChevronDown data-icon="inline-end" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 gap-2 p-2">
              <div className="flex flex-col gap-1">
                {COMMON_FONTS.map((font) => {
                  const selectedIndex = selectedFonts.indexOf(font.value);
                  const selected = selectedIndex >= 0;
                  const label = font.label["zh-CN"];
                  const checkboxId = `font-family-${font.value.replace(/[^a-zA-Z0-9]+/g, "-")}`;

                  return (
                    <div
                      key={font.value}
                      className="grid min-h-9 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60"
                    >
                      <Checkbox
                        id={checkboxId}
                        checked={selected}
                        onCheckedChange={(checked) => handleFontToggle(font.value, checked === true)}
                      />
                      <label
                        htmlFor={checkboxId}
                        className="min-w-0 cursor-pointer truncate text-sm font-normal"
                        style={{ fontFamily: font.stack }}
                      >
                        {label}
                      </label>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`上移 ${label}`}
                          disabled={!selected || selectedIndex === 0}
                          onClick={() => handleFontMove(font.value, -1)}
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`下移 ${label}`}
                          disabled={!selected || selectedIndex === selectedFonts.length - 1}
                          onClick={() => handleFontMove(font.value, 1)}
                        >
                          <ArrowDown />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        <div className="grid grid-cols-2 gap-3">
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
        </div>
      </div>
    </InspectorSection>
  );
}
