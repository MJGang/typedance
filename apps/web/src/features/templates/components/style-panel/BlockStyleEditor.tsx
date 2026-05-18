import { List, RotateCcw, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BlockStyle, BlockType } from "../../style-engine/types";
import { TypographySection } from "./sections/TypographySection";
import { ColorSection } from "./sections/ColorSection";
import { SpacingSection } from "./sections/SpacingSection";
import { AlignmentSection } from "./sections/AlignmentSection";
import { BorderSection } from "./sections/BorderSection";
import { ListSection } from "./sections/ListSection";

type BlockStyleEditorProps = {
  blockType: BlockType;
  value: BlockStyle;
  onChange: (style: BlockStyle) => void;
};

const LIST_TEXT_KEYS: Array<keyof BlockStyle> = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "textTransform",
  "color",
  "backgroundColor",
  "textAlign",
];

function clearListTextOverrides(value: BlockStyle): BlockStyle {
  const next = { ...value };
  for (const key of LIST_TEXT_KEYS) {
    delete next[key];
  }
  return next;
}

function hasListTextOverrides(value: BlockStyle): boolean {
  return LIST_TEXT_KEYS.some((key) => value[key] !== undefined);
}

export function BlockStyleEditor({ blockType, value, onChange }: BlockStyleEditorProps) {
  const isList = blockType === "bulletList" || blockType === "orderedList";

  if (isList) {
    const hasOverrides = hasListTextOverrides(value);

    return (
      <div className="flex flex-col gap-2 px-1 py-1">
        <section className="rounded-md border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
            <List className="size-3.5 text-muted-foreground" />
            <span className="text-sm font-medium">列表结构</span>
          </div>
          <div className="flex flex-col">
            <ListSection value={value} onChange={onChange} />
            <SpacingSection value={value} onChange={onChange} />
          </div>
        </section>

        <section className="rounded-md border border-border bg-card">
          <div className="flex items-start gap-2 border-b border-border px-2 py-1.5">
            <Type className="mt-0.5 size-3.5 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">文字覆盖</div>
              <p className="mt-0.5 text-xs leading-4 text-muted-foreground">
                留空时跟随“正文”样式；填写后只覆盖当前列表里的文字。
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 px-2 text-xs"
              disabled={!hasOverrides}
              onClick={() => onChange(clearListTextOverrides(value))}
            >
              <RotateCcw className="mr-1 size-3" />
              清空
            </Button>
          </div>
          <div className="flex flex-col">
            <TypographySection value={value} onChange={onChange} />
            <ColorSection value={value} onChange={onChange} />
            <AlignmentSection value={value} onChange={onChange} />
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <TypographySection value={value} onChange={onChange} />
      <ColorSection value={value} onChange={onChange} />
      <SpacingSection value={value} onChange={onChange} />
      <AlignmentSection value={value} onChange={onChange} />
      <BorderSection value={value} onChange={onChange} />
    </div>
  );
}
