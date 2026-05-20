import { useState, useCallback, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import type { BlockType, TemplateStyleConfig } from "../../style-engine/types";
import { BlockSelector } from "./BlockSelector";
import { BlockStyleEditor } from "./BlockStyleEditor";
import { PresetSelector } from "./PresetSelector";
import { StyleStatusBar } from "./StyleStatusBar";
import { getPreset } from "../../style-engine/presets";
import { saveTemplateStyle } from "@/api";
import { ColumnsSection } from "./sections/ColumnsSection";
import type { ColumnsCount, ColumnsGap } from "@typedance/tiptap-layout";

const PRESET_LABELS: Record<string, string> = {
  classic: "经典",
  modern: "现代",
  clean: "简洁",
};

type StylePanelProps = {
  styleConfig: TemplateStyleConfig;
  onChange: (config: TemplateStyleConfig) => void;
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
  onChange,
  activeBlock,
  onActiveBlockChange,
  activeColumnsCount,
  activeColumnsGap,
  onActiveColumnsCountChange,
  onActiveColumnsGapChange,
  onUnsetColumns,
  uiLanguage,
}: StylePanelProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isCustom = !styleConfig.preset || styleConfig.preset === "custom";
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
      setSaving(true);
      setError(null);
      saveTemplateStyle(next)
        .then((saved) => { onChange({ ...saved, preset: next.preset }); setSaving(false); })
        .catch(() => { setError("保存失败，稍后重试"); setSaving(false); });
    }, 300);
  }, [styleConfig, activeBlock, onChange]);

  const handlePresetChange = useCallback((presetName: string) => {
    const preset = getPreset(presetName);
    if (!preset) return;
    const next: TemplateStyleConfig = {
      ...styleConfig,
      preset: presetName,
      blocks: { ...preset },
    };
    onChange(next);

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setSaving(true);
      setError(null);
      saveTemplateStyle(next)
        .then((saved) => { onChange({ ...saved, preset: presetName }); setSaving(false); })
        .catch(() => { setError("保存失败，稍后重试"); setSaving(false); });
    }, 300);
  }, [styleConfig, onChange]);

  const handleNameChange = useCallback((name: string) => {
    const next = { ...styleConfig, name };
    onChange(next);

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setSaving(true);
      setError(null);
      saveTemplateStyle(next)
        .then((saved) => { onChange({ ...saved, preset: styleConfig.preset }); setSaving(false); })
        .catch(() => { setError("保存失败，稍后重试"); setSaving(false); });
    }, 300);
  }, [styleConfig, onChange]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <div className="td-style-panel flex h-full flex-col">
      <div className="flex flex-col gap-3 border-b border-border px-3 py-3">
        <div>
          <h3 className="m-0 text-sm font-semibold">主题样式</h3>
          <p className="m-0 mt-1 text-xs leading-5 text-muted-foreground">选择段落后调整全局样式，按钮样式与编辑器工具栏保持一致。</p>
        </div>
        <PresetSelector value={isCustom ? "custom" : styleConfig.preset} onChange={handlePresetChange} />

        {isCustom ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground shrink-0 w-12">名称</span>
            <Input
              value={styleConfig.name ?? ""}
              placeholder="自定义模板"
              className="h-7 text-xs"
              onChange={(e) => handleNameChange(e.target.value)}
            />
          </div>
        ) : (
          <div className="flex items-center gap-2 px-1">
            <span className="text-xs text-muted-foreground">{PRESET_LABELS[styleConfig.preset] ?? styleConfig.preset} 预设</span>
          </div>
        )}

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

      <div className="border-t border-border">
        <StyleStatusBar updatedAt={styleConfig.updated_at} saving={saving} error={error} />
      </div>
    </div>
  );
}
