import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { TargetLanguage, UiLanguage } from "../../workspace/types"
import type {
  ResumeTemplateDefinition,
  TemplateSampleContent,
  TemplateStyleConfig,
} from "../types"
import { TemplatePreview } from "./TemplatePreview"

type TemplateCardProps = {
  template: ResumeTemplateDefinition
  sample: TemplateSampleContent
  styleConfig: TemplateStyleConfig
  uiLanguage: UiLanguage
  targetLanguage: TargetLanguage
  onApply?: () => void
}

export function TemplateCard({
  template,
  sample,
  styleConfig,
  uiLanguage,
  targetLanguage,
  onApply,
}: TemplateCardProps) {
  return (
    <div className="td-template-card">
      <TemplatePreview sample={sample} styleConfig={styleConfig} />
      <span className="td-template-card-title">{template.localizedName[uiLanguage]}</span>
      <span className="td-template-card-description">{template.description[uiLanguage]}</span>
      <span className="td-template-card-tags">
        {template.tags[uiLanguage].map((tag) => (
          <Badge key={tag} variant="secondary">
            {tag}
          </Badge>
        ))}
        <Badge variant={template.languages.includes(targetLanguage) ? "default" : "secondary"}>
          {template.status === "built-in" ? "内置" : "规划中"}
        </Badge>
      </span>
      {onApply && (
        <Button
          size="sm"
          className="mt-2 w-full"
          onClick={onApply}
        >
          应用
        </Button>
      )}
    </div>
  )
}
