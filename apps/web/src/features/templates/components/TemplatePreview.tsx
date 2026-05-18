import { renderStyledContentHtml } from "@typedance/resume-renderer"
import type { TemplateSampleContent, TemplateStyleConfig } from "../types"
import { generateFullCSS } from "../style-engine/css-generator"

type TemplatePreviewProps = {
  sample: TemplateSampleContent
  styleConfig: TemplateStyleConfig
  scale?: "card" | "detail"
}

export function TemplatePreview({ sample, styleConfig, scale = "card" }: TemplatePreviewProps) {
  const cssText = generateFullCSS(styleConfig.blocks ?? {})
  const html = renderStyledContentHtml(sample.doc_json)

  return (
    <div className={`td-template-preview td-template-preview-${scale}`}>
      <style>{cssText}</style>
      <article
        className="td-template-paper"
        aria-label="A4 template sample preview"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
