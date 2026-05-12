import { useState, useCallback, useRef, useEffect } from "react";
import type { BlockType, TemplateStyleConfig } from "../../style-engine/types";
import { BlockSelector } from "./BlockSelector";
import { BlockStyleEditor } from "./BlockStyleEditor";
import { PresetSelector } from "./PresetSelector";
import { StyleStatusBar } from "./StyleStatusBar";
import { getPreset } from "../../style-engine/presets";
import { saveTemplateStyle } from "@/api";

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
        .catch((e: Error) => { setError("保存失败，稍后重试"); setSaving(false); });
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
        .catch((e: Error) => { setError("保存失败，稍后重试"); setSaving(false); console.log('???', e)});
    }, 300);
  }, [styleConfig, onChange]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <aside className="td-style-panel">
      <PresetSelector value={styleConfig.preset || "custom"} onChange={handlePresetChange} />
      <BlockSelector active={activeBlock} onChange={onActiveBlockChange} uiLanguage={uiLanguage} />
      <BlockStyleEditor
        blockType={activeBlock}
        value={currentBlockStyle}
        onChange={handleBlockStyleChange}
      />
      <StyleStatusBar updatedAt={styleConfig.updated_at} saving={saving} error={error} />
    </aside>
  );
}
