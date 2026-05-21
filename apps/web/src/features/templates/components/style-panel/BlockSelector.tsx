import { List, ListOrdered } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { BlockType } from "../../style-engine/types";
import { BLOCK_TYPE_LABELS } from "../../style-engine/types";

type BlockSelectorProps = {
  active: BlockType;
  onChange: (block: BlockType) => void;
  uiLanguage: "zh-CN" | "en-US";
};

const TEXT_BLOCK_TYPES: BlockType[] = ["heading1", "heading2", "heading3", "paragraph"];
const LIST_BLOCK_TYPES: BlockType[] = ["bulletList", "orderedList"];

export function BlockSelector({ active, onChange, uiLanguage }: BlockSelectorProps) {
  const handleChange = (value: string) => {
    if (value) onChange(value as BlockType);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-medium text-foreground">段落样式</span>
        <span className="text-xs text-muted-foreground">{BLOCK_TYPE_LABELS[active][uiLanguage]}</span>
      </div>

      <ToggleGroup
        type="single"
        value={TEXT_BLOCK_TYPES.includes(active) ? active : undefined}
        onValueChange={handleChange}
        className="grid w-full grid-cols-4 gap-1"
        aria-label="选择文本段落样式"
      >
        {TEXT_BLOCK_TYPES.map((blockType) => (
          <ToggleGroupItem key={blockType} value={blockType} size="sm" className="w-full text-xs">
            {BLOCK_TYPE_LABELS[blockType][uiLanguage]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <ToggleGroup
        type="single"
        value={LIST_BLOCK_TYPES.includes(active) ? active : undefined}
        onValueChange={handleChange}
        className="grid w-full grid-cols-2 gap-1"
        aria-label="选择列表段落样式"
      >
        <ToggleGroupItem value="bulletList" size="sm" className="w-full text-xs">
          <List data-icon="inline-start" />
          {BLOCK_TYPE_LABELS.bulletList[uiLanguage]}
        </ToggleGroupItem>
        <ToggleGroupItem value="orderedList" size="sm" className="w-full text-xs">
          <ListOrdered data-icon="inline-start" />
          {BLOCK_TYPE_LABELS.orderedList[uiLanguage]}
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}
