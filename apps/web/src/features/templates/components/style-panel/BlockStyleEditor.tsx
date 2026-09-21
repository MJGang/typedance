import { List, RotateCcw, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BlockStyle, BlockType } from "../../style-engine/types";
import type { Heading2BlockStyle } from "@typedance/contracts";
import { TypographySection } from "./sections/TypographySection";
import { ColorSection } from "./sections/ColorSection";
import { SpacingSection } from "./sections/SpacingSection";
import { AlignmentSection } from "./sections/AlignmentSection";
import { BorderSection } from "./sections/BorderSection";
import { ListSection } from "./sections/ListSection";
import { InspectorAccordion } from "./InspectorControls";
import { HeadingDecorationSection } from "./sections/HeadingDecorationSection";

type BlockStyleEditorProps = {
  blockType: BlockType;
  value: BlockStyle | Heading2BlockStyle;
  accentColor: string;
  onChange: (style: BlockStyle | Heading2BlockStyle) => void;
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

export function BlockStyleEditor({ blockType, value, accentColor, onChange }: BlockStyleEditorProps) {
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
          <InspectorAccordion key={`${blockType}-structure`} type="single" collapsible defaultValue="list">
            <ListSection value={value} onChange={onChange} />
            <SpacingSection value={value} onChange={onChange} />
          </InspectorAccordion>
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
          <InspectorAccordion key={`${blockType}-text`} type="single" collapsible defaultValue="typography">
            <TypographySection value={value} onChange={onChange} />
            <ColorSection value={value} onChange={onChange} />
            <AlignmentSection value={value} onChange={onChange} />
          </InspectorAccordion>
        </section>
      </div>
    );
  }

  return (
    <InspectorAccordion
      key={blockType}
      type="single"
      collapsible
      defaultValue={blockType === "heading2" ? "heading-decoration" : "typography"}
    >
      {blockType === "heading2" ? (
        <HeadingDecorationSection
          value={(value as Heading2BlockStyle).decorationStyle}
          accentColor={accentColor}
          onChange={(decorationStyle) => onChange({ ...value, decorationStyle })}
        />
      ) : null}
      <TypographySection value={value} onChange={onChange} />
      <ColorSection value={value} onChange={onChange} showBackground={blockType !== "heading2"} />
      <SpacingSection value={value} onChange={onChange} />
      <AlignmentSection value={value} onChange={onChange} />
      {blockType !== "heading2" ? <BorderSection value={value} onChange={onChange} /> : null}
    </InspectorAccordion>
  );
}
