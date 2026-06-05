import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowLeft, RotateCcw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { UiLanguage } from "../../workspace/types"
import type { ResumeDocJson } from "../../workspace/editor"
import type { BlockType, TemplateStyleConfig } from "../types"
import { ResumeRichTextEditor } from "../../workspace/components/ResumeRichTextEditor"
import { StylePanel } from "./style-panel/StylePanel"
import { generateFullCSS, generateWorkspaceCSS } from "../style-engine/css-generator"
import type { TemplateSampleContent } from "../types"

export type ThemeDetailItem = {
  id: string
  title: string
  description: string
  source: "default" | "custom"
  styleConfig: TemplateStyleConfig
}

type TemplateDetailProps = {
  theme: ThemeDetailItem
  themes: ThemeDetailItem[]
  sample: TemplateSampleContent
  uiLanguage: UiLanguage
  onBack: () => void
  onThemeChange: (themeId: string) => void
  onStyleChange: (style: TemplateStyleConfig) => void
  onResetTheme?: () => void
  onSampleChange: (sample: TemplateSampleContent) => void
  onSaveSample: () => void
  sampleStatus: string
  styleStatus: string
}

type TemplateStatusTextProps = {
  status: string
  className: string
}

const VALID_BLOCKS: BlockType[] = [
  "heading1",
  "heading2",
  "heading3",
  "paragraph",
  "bulletList",
  "orderedList",
]

export function TemplateStatusText({ status, className }: TemplateStatusTextProps) {
  const isPending = status.includes("正在")
  const [dotCount, setDotCount] = useState(1)

  useEffect(() => {
    if (!isPending) {
      setDotCount(1)
      return undefined
    }

    const timer = window.setInterval(() => {
      setDotCount((current) => current >= 3 ? 1 : current + 1)
    }, 420)

    return () => window.clearInterval(timer)
  }, [isPending])

  return (
    <p aria-live="polite" className={className}>
      {status}
      {isPending && (
        <span aria-hidden="true" className="inline-block w-4 text-left">
          {".".repeat(dotCount)}
        </span>
      )}
    </p>
  )
}

export function TemplateDetail({
  theme,
  themes,
  sample,
  uiLanguage,
  onBack,
  onThemeChange,
  onStyleChange,
  onResetTheme,
  sampleStatus,
  styleStatus,
}: TemplateDetailProps) {
  const [activeBlock, setActiveBlock] = useState<BlockType>("paragraph")
  const [sampleDoc, setSampleDoc] = useState<ResumeDocJson>(sample.doc_json as ResumeDocJson)

  useEffect(() => {
    setSampleDoc(sample.doc_json as ResumeDocJson)
  }, [sample.id, sample.doc_json])

  const cssText = useMemo(
    () => generateFullCSS(theme.styleConfig.blocks ?? {}),
    [theme.styleConfig],
  )
  const elementCssText = useMemo(
    () => generateWorkspaceCSS(theme.styleConfig.blocks ?? {}, ".td-template-editor-wrapper"),
    [theme.styleConfig],
  )

  const handleSelectionUpdate = useCallback((blockName: string) => {
    if (VALID_BLOCKS.includes(blockName as BlockType)) {
      setActiveBlock(blockName as BlockType)
    }
  }, [])

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" size="icon-sm" className="-ml-2" onClick={onBack} aria-label="返回主题库">
              <ArrowLeft />
            </Button>
            <h2 className="m-0 text-xl font-semibold tracking-normal">{theme.title}</h2>
            <Badge variant={theme.source === "default" ? "default" : "secondary"}>
              {theme.source === "default" ? "官方默认" : "我的主题"}
            </Badge>
            {onResetTheme && (
              <Button type="button" variant="outline" size="sm" onClick={onResetTheme}>
                <RotateCcw data-icon="inline-start" />
                重置
              </Button>
            )}
          </div>
          <TemplateStatusText status={styleStatus} className="m-0 text-xs text-muted-foreground" />
        </div>
      </div>

      <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(520px,1fr)_minmax(320px,380px)]">
        <div className="grid min-h-0 gap-3 rounded-lg border border-border bg-card p-3 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
            <div>
              <h3 className="m-0 text-sm font-semibold">演示简历</h3>
            </div>
            <p aria-live="polite" className="m-0 text-xs text-muted-foreground">{sampleStatus}</p>
          </div>
          <div className="td-template-editor-wrapper min-h-0 overflow-auto rounded-md bg-muted/45 px-4 py-5">
            <style>{cssText}</style>
            <style>{elementCssText}</style>
            <ResumeRichTextEditor
              ariaLabel="主题演示简历预览"
              docJson={sampleDoc}
              editable={false}
              onChange={() => undefined}
              onSelectionUpdate={handleSelectionUpdate}
            />
          </div>
        </div>

        <aside className="min-h-0 overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <StylePanel
            styleConfig={theme.styleConfig}
            selectedThemeId={theme.id}
            themeOptions={themes}
            onChange={onStyleChange}
            onThemeChange={onThemeChange}
            activeBlock={activeBlock}
            onActiveBlockChange={setActiveBlock}
            uiLanguage={uiLanguage}
          />
        </aside>
      </div>
    </section>
  )
}
