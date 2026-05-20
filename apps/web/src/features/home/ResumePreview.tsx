import { useMemo } from "react"
import { renderStyledContentHtml } from "@typedance/resume-renderer"
import { generateFullCSS } from "../templates/style-engine/css-generator"
import type { TemplateStyleConfig } from "@typedance/contracts"

type ResumePreviewProps = {
  docJson: Record<string, unknown>
  styleConfig: TemplateStyleConfig
}

export function ResumePreview({ docJson, styleConfig }: ResumePreviewProps) {
  const cssText = useMemo(() => generateFullCSS(styleConfig.blocks ?? {}), [styleConfig])
  const html = useMemo(() => renderStyledContentHtml(docJson), [docJson])

  return (
    <>
      <style>{cssText}</style>
      <div className="td-resume-preview-inner h-full">
        {html ? (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            暂无内容
          </div>
        )}
      </div>
    </>
  )
}
