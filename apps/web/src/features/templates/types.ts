import type {
  PdfClassPolicy,
  TemplateSampleContent,
  TemplateStyleConfig,
} from "@typedance/contracts"
import type { TargetLanguage, UiLanguage } from "../workspace/types"

export type TemplateStatus = "built-in" | "planned"

export type ResumeTemplateDefinition = {
  id: string
  name: string
  localizedName: Record<UiLanguage, string>
  description: Record<UiLanguage, string>
  languages: TargetLanguage[]
  status: TemplateStatus
  tags: Record<UiLanguage, string[]>
  sampleContentIds: Partial<Record<TargetLanguage, string>>
  configSummary: {
    pageSize: string
    margin: string
    fontStack: string
    accentColor: string
    layout: string
  }
  implementation: {
    packageName: string
    rendererEntry: string
    templateId: string
  }
  futureConfig: Record<UiLanguage, string[]>
}

export type TemplateLibraryTab = "templates" | "samples"
export type ClassValidationReason = "blocked" | "not_allowed"
export type ClassValidationIssue = { className: string; reason: ClassValidationReason }

export type { PdfClassPolicy, TemplateSampleContent, TemplateStyleConfig }
