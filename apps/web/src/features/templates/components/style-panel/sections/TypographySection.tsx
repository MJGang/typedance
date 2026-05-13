import { ChevronDown, Type } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { BlockStyle } from "../../../style-engine/types";
import { COMMON_FONTS } from "../../../style-engine/fonts";

type Props = { value: BlockStyle; onChange: (v: BlockStyle) => void };

export function TypographySection({ value, onChange }: Props) {
  return (
    <Collapsible defaultOpen>
      <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-muted [&[data-state=open]>svg:first-child]:rotate-0">
        <ChevronDown className="size-3.5 -rotate-90 text-muted-foreground transition-transform duration-200" />
        <Type className="size-3.5 text-muted-foreground" />
        <span className="flex-1 text-left">排版</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 p-2">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">字体</label>
          <Select value={value.fontFamily} onValueChange={(v) => onChange({ ...value, fontFamily: v })}>
            <SelectTrigger><SelectValue placeholder="默认" /></SelectTrigger>
            <SelectContent>
              {COMMON_FONTS.map((f) => (
                <SelectItem key={f.value} value={f.value}>{f.label["zh-CN"]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">字号</label>
            <Input value={value.fontSize ?? ""} placeholder="如 14pt" onChange={(e) => onChange({ ...value, fontSize: e.target.value })} />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">字重</label>
            <Select value={String(value.fontWeight ?? "")} onValueChange={(v) => onChange({ ...value, fontWeight: v ? Number(v) as 400|500|600|700 : undefined })}>
              <SelectTrigger><SelectValue placeholder="默认" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="400">常规</SelectItem>
                <SelectItem value="500">中粗</SelectItem>
                <SelectItem value="600">半粗</SelectItem>
                <SelectItem value="700">粗体</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex gap-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">行高</label>
            <Input value={value.lineHeight ?? ""} placeholder="如 1.5" onChange={(e) => onChange({ ...value, lineHeight: e.target.value ? Number(e.target.value) : undefined })} />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">字间距</label>
            <Input value={value.letterSpacing ?? ""} placeholder="如 0.5pt" onChange={(e) => onChange({ ...value, letterSpacing: e.target.value })} />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">大小写</label>
          <ToggleGroup
            type="single"
            value={value.textTransform ?? "none"}
            onValueChange={(v) => onChange({ ...value, textTransform: v as BlockStyle["textTransform"] })}
          >
            <ToggleGroupItem value="none">无</ToggleGroupItem>
            <ToggleGroupItem value="uppercase">大写</ToggleGroupItem>
            <ToggleGroupItem value="capitalize">首字母大写</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
