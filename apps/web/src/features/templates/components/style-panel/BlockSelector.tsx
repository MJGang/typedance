import type { BlockType } from "../../../style-engine/types";
import { BLOCK_TYPES, BLOCK_TYPE_LABELS } from "../../../style-engine/types";

type BlockSelectorProps = {
  active: BlockType;
  onChange: (block: BlockType) => void;
  uiLanguage: "zh-CN" | "en-US";
};

export function BlockSelector({ active, onChange, uiLanguage }: BlockSelectorProps) {
  return (
    <div className="td-block-selector flex flex-wrap gap-1" role="tablist">
      {BLOCK_TYPES.map((bt) => (
        <button
          key={bt}
          type="button"
          role="tab"
          aria-selected={bt === active}
          className={`td-block-tab ${bt === active ? "td-block-tab-active" : ""}`}
          onClick={() => onChange(bt)}
        >
          {BLOCK_TYPE_LABELS[bt][uiLanguage]}
        </button>
      ))}
    </div>
  );
}
