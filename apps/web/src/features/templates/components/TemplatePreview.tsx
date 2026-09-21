import { useLayoutEffect, useRef, useState } from "react"
import { generateTemplateCSS, renderStyledContentHtml } from "@typedance/resume-renderer"
import type { TemplateSampleContent, TemplateStyleConfig } from "../types"

type TemplatePreviewProps = {
  sample: TemplateSampleContent
  styleConfig: TemplateStyleConfig
  scale?: "card" | "detail"
}

const A4_WIDTH_PX = 794
const A4_HEIGHT_PX = 1123

export function TemplatePreview({ sample, styleConfig, scale = "card" }: TemplatePreviewProps) {
  const frameRef = useRef<HTMLDivElement>(null)
  const [frameWidth, setFrameWidth] = useState(A4_WIDTH_PX)
  const cssText = generateTemplateCSS(styleConfig)
  const html = renderStyledContentHtml(sample.doc_json, styleConfig)
  const previewScale = frameWidth / A4_WIDTH_PX

  useLayoutEffect(() => {
    const element = frameRef.current
    if (!element) return

    const updateWidth = () => {
      const nextWidth = element.getBoundingClientRect().width
      if (nextWidth > 0) setFrameWidth(nextWidth)
    }

    updateWidth()

    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(updateWidth)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={frameRef}
      className={`td-template-preview td-template-preview-${scale}`}
      style={{ height: `${A4_HEIGHT_PX * previewScale}px` }}
    >
      <style>{cssText}</style>
      <div
        className="td-template-paper-scale"
        style={{
          width: A4_WIDTH_PX,
          height: A4_HEIGHT_PX,
          transform: `scale(${previewScale})`,
        }}
      >
        <article
          className="td-template-paper"
          aria-label="A4 template sample preview"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  )
}
