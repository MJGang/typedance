import { ArrowLeft, Save } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { UiLanguage } from "../../workspace/types"
import { validateTemplateClasses } from "../classPolicy"
import type {
  PdfClassPolicy,
  ResumeTemplateDefinition,
  TemplateSampleContent,
  TemplateStyleConfig,
} from "../types"
import { TemplatePreview } from "./TemplatePreview"

type TemplateDetailProps = {
  template: ResumeTemplateDefinition
  sample: TemplateSampleContent
  styleConfig: TemplateStyleConfig
  policy: PdfClassPolicy
  uiLanguage: UiLanguage
  onBack: () => void
  onStyleChange: (style: TemplateStyleConfig) => void
  onSaveStyle: () => void
  styleStatus: string
}

export function TemplateDetail({
  template,
  sample,
  styleConfig,
  policy,
  uiLanguage,
  onBack,
  onStyleChange,
  onSaveStyle,
  styleStatus,
}: TemplateDetailProps) {
  return (
    <section className="td-template-detail">
      <div className="td-template-detail-header">
        <Button type="button" variant="outline" onClick={onBack}>
          <ArrowLeft data-icon="inline-start" />
          返回模板库
        </Button>
        <Badge>{template.status === "built-in" ? "当前可用" : "规划中"}</Badge>
      </div>

      <div className="td-template-detail-grid">
        <TemplatePreview sample={sample} styleConfig={styleConfig} scale="detail" />
        <aside className="td-template-detail-panel">
          <h2>{template.localizedName[uiLanguage]}</h2>
          <p>{template.description[uiLanguage]}</p>
          <dl className="td-template-meta">
            <dt>template_id</dt>
            <dd>{template.implementation.templateId}</dd>
            <dt>页面尺寸</dt>
            <dd>{template.configSummary.pageSize}</dd>
            <dt>页边距</dt>
            <dd>{template.configSummary.margin}</dd>
            <dt>字体</dt>
            <dd>{template.configSummary.fontStack}</dd>
            <dt>渲染入口</dt>
            <dd>{template.implementation.rendererEntry}</dd>
          </dl>

          <h3>Tailwind class 配置</h3>
          {Object.entries(styleConfig.slots).map(([slotName, slot]) => {
            const issues = validateTemplateClasses(slot.class_name, policy)
            return (
              <label key={slotName} className="td-template-style-field">
                <span>{slot.label[uiLanguage]}</span>
                <Input
                  value={slot.class_name}
                  aria-invalid={issues.length > 0}
                  onChange={(event) =>
                    onStyleChange({
                      ...styleConfig,
                      slots: {
                        ...styleConfig.slots,
                        [slotName]: { ...slot, class_name: event.target.value },
                      },
                    })
                  }
                />
                {issues.length ? (
                  <small role="alert">
                    {issues.map((issue) => `${issue.className}:${issue.reason}`).join(", ")}
                  </small>
                ) : (
                  <small>PDF 支持</small>
                )}
              </label>
            )
          })}
          <Button type="button" onClick={onSaveStyle}>
            <Save data-icon="inline-start" />
            保存样式
          </Button>
          <p aria-live="polite">{styleStatus}</p>
        </aside>
      </div>
    </section>
  )
}
