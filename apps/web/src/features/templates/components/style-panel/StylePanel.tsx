import { useCallback, useRef, useEffect } from "react";
import type { BlockType, TemplateStyleConfig } from "../../style-engine/types";
import { BlockSelector } from "./BlockSelector";
import { BlockStyleEditor } from "./BlockStyleEditor";
import { ThemeSelector, type ThemeSelectorOption } from "./ThemeSelector";
import { saveTemplateStyle } from "@/api";
import { ColumnsSection } from "./sections/ColumnsSection";
import type { ColumnsCount, ColumnsGap } from "@typedance/tiptap-layout";

type StylePanelProps = {
  styleConfig: TemplateStyleConfig;
  selectedThemeId: string;
  themeOptions: ThemeSelectorOption[];
  onChange: (config: TemplateStyleConfig) => void;
  onThemeChange: (themeId: string) => void;
  activeBlock: BlockType;
  onActiveBlockChange: (block: BlockType) => void;
  activeColumnsCount?: ColumnsCount | null;
  activeColumnsGap?: ColumnsGap | null;
  onActiveColumnsCountChange?: (count: ColumnsCount) => void;
  onActiveColumnsGapChange?: (gap: ColumnsGap) => void;
  onUnsetColumns?: () => void;
  uiLanguage: "zh-CN" | "en-US";
};

export function StylePanel({
  styleConfig,
  selectedThemeId,
  themeOptions,
  onChange,
  onThemeChange,
  activeBlock,
  onActiveBlockChange,
  activeColumnsCount,
  activeColumnsGap,
  onActiveColumnsCountChange,
  onActiveColumnsGapChange,
  onUnsetColumns,
  uiLanguage,
}: StylePanelProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentBlockStyle = styleConfig.blocks[activeBlock] ?? {};

  const handleBlockStyleChange = useCallback((newStyle: typeof currentBlockStyle) => {
    const next: TemplateStyleConfig = {
      ...styleConfig,
      preset: "",
      blocks: { ...styleConfig.blocks, [activeBlock]: newStyle },
    };
    onChange(next);

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      saveTemplateStyle(next)
        .then((saved) => { onChange({ ...saved, preset: next.preset }); })
        .catch(() => undefined);
    }, 300);
  }, [styleConfig, activeBlock, onChange]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <div className="td-style-panel flex h-full flex-col">
      <div className="flex flex-col gap-3 border-b border-border px-3 py-3">
        <div>
          <h3 className="m-0 text-sm font-semibold">主题样式</h3>
          <p className="m-0 mt-1 text-xs leading-5 text-muted-foreground">选择段落后调整全局样式，按钮样式与编辑器工具栏保持一致。</p>
        </div>
        <ThemeSelector value={selectedThemeId} options={themeOptions} onChange={onThemeChange} />

        <BlockSelector active={activeBlock} onChange={onActiveBlockChange} uiLanguage={uiLanguage} />
      </div>

      <div className="flex-1 overflow-y-auto px-1 py-1">
        {activeColumnsCount && activeColumnsGap && onActiveColumnsCountChange && onActiveColumnsGapChange && onUnsetColumns && (
          <ColumnsSection
            count={activeColumnsCount}
            gap={activeColumnsGap}
            onCountChange={onActiveColumnsCountChange}
            onGapChange={onActiveColumnsGapChange}
            onUnsetColumns={onUnsetColumns}
          />
        )}
        <BlockStyleEditor
          blockType={activeBlock}
          value={currentBlockStyle}
          onChange={handleBlockStyleChange}
        />
      </div>

    </div>
  );
}
