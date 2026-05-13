import { useState, useCallback, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import type { BlockType, TemplateStyleConfig } from "../../style-engine/types";
import { BlockSelector } from "./BlockSelector";
import { BlockStyleEditor } from "./BlockStyleEditor";
import { PresetSelector } from "./PresetSelector";
import { StyleStatusBar } from "./StyleStatusBar";
import { getPreset } from "../../style-engine/presets";
import { saveTemplateStyle } from "@/api";

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
  uiLanguage: "zh-CN" | "en-US";
};

export function StylePanel({
  styleConfig,
  onChange,
  activeBlock,
  onActiveBlockChange,
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
    <div className="flex h-full flex-col">
      {/* Preset + Block selector header */}
      <div className="flex flex-col gap-2 border-b border-border px-3 py-2.5">
        <PresetSelector value={isCustom ? "custom" : styleConfig.preset} onChange={handlePresetChange} />

        {/* Template name (custom mode: editable, preset mode: read-only label) */}
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

      {/* Scrollable style sections */}
      <div className="flex-1 overflow-y-auto px-1 py-1">
        <BlockStyleEditor
          blockType={activeBlock}
          value={currentBlockStyle}
          onChange={handleBlockStyleChange}
        />
      </div>

      {/* Status bar footer */}
      <div className="border-t border-border">
        <StyleStatusBar updatedAt={styleConfig.updated_at} saving={saving} error={error} />
      </div>
    </div>
  );
}
