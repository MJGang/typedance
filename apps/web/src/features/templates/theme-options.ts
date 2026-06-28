import type { UiLanguage } from "../workspace/types"
import { defaultClassicA4Style, templateRegistry } from "./data"
import type { TemplateStyleConfig } from "./types"

export type TemplateTheme = {
  id: string
  title: string
  description: string
  source: "default" | "custom"
  styleConfig: TemplateStyleConfig
}

export function isDefaultTemplateId(templateId: string) {
  return templateRegistry.some((template) => template.id === templateId)
}

function builtInStyleFor(templateId: string, name: string): TemplateStyleConfig {
  if (templateId === defaultClassicA4Style.template_id) {
    return defaultClassicA4Style
  }
  return {
    ...defaultClassicA4Style,
    template_id: templateId,
    name,
    blocks: { ...defaultClassicA4Style.blocks },
  }
}

export function buildTemplateThemes(
  savedStyles: TemplateStyleConfig[],
  uiLanguage: UiLanguage,
): TemplateTheme[] {
  const styleMap = new Map(savedStyles.map((style) => [style.template_id, style]))
  const defaultThemes = templateRegistry.map((template) => {
    const localizedName = template.localizedName[uiLanguage]
    const styleConfig = styleMap.get(template.id) ?? builtInStyleFor(template.id, localizedName)
    return {
      id: template.id,
      title: styleConfig.name ?? localizedName,
      description: template.description[uiLanguage],
      source: "default" as const,
      styleConfig,
    }
  })
  const customThemes = savedStyles
    .filter((style) => !isDefaultTemplateId(style.template_id))
    .map((style, index) => ({
      id: style.template_id,
      title: style.name?.trim() || `自定义主题 ${index + 1}`,
      description: "从工作台或主题库保存的本地主题，可继续调整字体、颜色和段落层级。",
      source: "custom" as const,
      styleConfig: style,
    }))

  return [...customThemes, ...defaultThemes]
}
