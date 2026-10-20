import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { CopyPlus, RotateCcw, Save } from "lucide-react"
import { generateTemplateCSS, generateWorkspaceTemplateCSS } from "@typedance/resume-renderer"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { DEFAULT_SOURCE_CANVAS_PAGE_MARGINS, loadPageMarginPreferences, SOURCE_CANVAS_PAGE_SIZE } from "../../revision/pageMargins"
import type { UiLanguage } from "../../workspace/types"
import type { ResumeDocJson } from "../../workspace/editor"
import type { BlockType, TemplateStyleConfig } from "../types"
import { ResumeRichTextEditor } from "../../workspace/components/ResumeRichTextEditor"
import { StylePanel } from "./style-panel/StylePanel"
import type { TemplateTheme } from "../theme-options"
import type { TemplateSampleContent } from "../types"

type TemplateDetailProps = {
  theme: TemplateTheme
  themes: TemplateTheme[]
  sample: TemplateSampleContent
  uiLanguage: UiLanguage
  onThemeChange: (themeId: string) => void
  onStyleChange: (style: TemplateStyleConfig) => void
  onSaveStyle: () => Promise<boolean>
  hasUnsavedStyleChanges: boolean
  isSavingStyle: boolean
  onResetTheme?: () => void
  sampleStatus: string
  styleStatus: string
  onSaveAsTemplate: () => void
  previewControls: ReactNode
  previewId: string
  previewDocJson?: ResumeDocJson
  previewLoading: boolean
  previewError?: string | null
  onRetryPreview: () => void
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
  onThemeChange,
  onStyleChange,
  onSaveStyle,
  hasUnsavedStyleChanges,
  isSavingStyle,
  onResetTheme,
  sampleStatus,
  styleStatus,
  onSaveAsTemplate,
  previewControls,
  previewId,
  previewDocJson,
  previewLoading,
  previewError,
  onRetryPreview,
}: TemplateDetailProps) {
  const [activeBlock, setActiveBlock] = useState<BlockType>("paragraph")
  const previewMargins = useMemo(() => loadPageMarginPreferences(previewId, SOURCE_CANVAS_PAGE_SIZE)
    ?? DEFAULT_SOURCE_CANVAS_PAGE_MARGINS, [previewId])

  const cssText = useMemo(
    () => generateTemplateCSS(theme.styleConfig),
    [theme.styleConfig],
  )
  const elementCssText = useMemo(
    () => generateWorkspaceTemplateCSS(theme.styleConfig, ".td-template-editor-wrapper"),
    [theme.styleConfig],
  )

  const handleSelectionUpdate = useCallback((blockName: string) => {
    if (VALID_BLOCKS.includes(blockName as BlockType)) {
      setActiveBlock(blockName as BlockType)
    }
  }, [])

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="m-0 truncate text-sm font-semibold">{theme.title}</h1>
            <Badge variant={theme.source === "default" ? "default" : "secondary"}>
              {theme.source === "default" ? "官方默认" : "我的主题"}
            </Badge>
            <Badge variant="secondary">模板编辑</Badge>
          </div>
          <TemplateStatusText status={styleStatus} className="m-0 text-xs text-muted-foreground" />
        </div>
        <div className="flex shrink-0 items-center gap-2">
            {onResetTheme && (
              <Button type="button" variant="outline" size="sm" onClick={onResetTheme} disabled={isSavingStyle}>
                <RotateCcw data-icon="inline-start" />
                重置
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" onClick={onSaveAsTemplate} disabled={isSavingStyle}>
              <CopyPlus data-icon="inline-start" />另存为新模板
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void onSaveStyle()}
              disabled={!hasUnsavedStyleChanges || isSavingStyle}
            >
              <Save data-icon="inline-start" />
              {isSavingStyle ? "保存中..." : "保存"}
            </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(18rem,0.85fr)] xl:grid-cols-[minmax(0,1fr)_380px] xl:grid-rows-none">
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-b border-border px-3 py-2">
            <h2 className="m-0 text-sm font-semibold">模板预览</h2>
            {previewControls}
          </div>
          <div className="td-template-editor-wrapper min-h-0 flex-1 overflow-auto bg-muted/30 px-4 py-3">
            <style>{cssText}</style>
            <style>{elementCssText}</style>
            {previewLoading ? <Skeleton aria-label="预览正在加载" className="mx-auto h-96 max-w-3xl" /> : previewError ? (
              <div className="flex h-full flex-col items-center justify-center gap-3"><p role="alert" className="text-sm text-muted-foreground">{previewError}</p><Button variant="outline" onClick={onRetryPreview}>重新加载预览</Button></div>
            ) : <ResumeRichTextEditor
              key={previewId}
              ariaLabel="主题演示简历预览"
              docJson={previewDocJson ?? sample.doc_json as ResumeDocJson}
              templateStyle={theme.styleConfig}
              marginConfig={previewMargins}
              editable={false}
              onChange={() => undefined}
              onSelectionUpdate={handleSelectionUpdate}
            />}
          </div>
          {sampleStatus ? <p aria-live="polite" className="sr-only">{sampleStatus}</p> : null}
        </div>

        <fieldset disabled={isSavingStyle} aria-label="模板样式设置" className="min-h-0 min-w-0 overflow-hidden border-t border-border bg-background xl:border-t-0 xl:border-l">
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
        </fieldset>
      </div>

    </section>
  )
}
