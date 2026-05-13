import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { BlockType } from "../../style-engine/types";
import { BLOCK_TYPES, BLOCK_TYPE_LABELS } from "../../style-engine/types";

type BlockSelectorProps = {
  active: BlockType;
  onChange: (block: BlockType) => void;
  uiLanguage: "zh-CN" | "en-US";
};

export function BlockSelector({ active, onChange, uiLanguage }: BlockSelectorProps) {
  return (
    <Tabs value={active} onValueChange={(v) => onChange(v as BlockType)} className="w-full">
      <TabsList className="flex h-auto w-full flex-wrap gap-0.5 p-1">
        {BLOCK_TYPES.map((bt) => (
          <TabsTrigger key={bt} value={bt} className="flex-1 text-xs data-[state=active]:font-medium">
            {BLOCK_TYPE_LABELS[bt][uiLanguage]}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
