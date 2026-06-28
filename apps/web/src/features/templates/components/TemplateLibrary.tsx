import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { deleteTemplateStyle, getTemplateSample, listTemplateStyles, saveTemplateSample, saveTemplateStyle } from "@/api"
import { Button } from "@/components/ui/button"
import { PreviewShowcaseCard } from "@/components/preview-showcase-card"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { FilePlus2, Pencil, Plus, Trash2 } from "lucide-react"
import { resumePackPaths } from "../../resume-pack/routes"
import type { TargetLanguage, UiLanguage } from "../../workspace/types"
import { builtInSamples, defaultClassicA4Style, templateRegistry } from "../data"
import { buildTemplateThemes, isDefaultTemplateId, type TemplateTheme } from "../theme-options"
import type { TemplateSampleContent, TemplateStyleConfig } from "../types"
import { TemplatePreview } from "./TemplatePreview"
import { TemplateDetail, TemplateStatusText } from "./TemplateDetail"

type TemplateLibraryProps = {
  uiLanguage?: UiLanguage
  targetLanguage?: TargetLanguage
}

type ThemeFilter = "all" | "custom" | "default"

const FILTERS: Array<{ value: ThemeFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "custom", label: "我的" },
  { value: "default", label: "官方" },
]

function upsertTemplateStyle(
  styles: TemplateStyleConfig[],
  nextStyle: TemplateStyleConfig,
) {
  const exists = styles.some((style) => style.template_id === nextStyle.template_id)
  return exists
    ? styles.map((style) => style.template_id === nextStyle.template_id ? nextStyle : style)
    : [nextStyle, ...styles]
}

export function TemplateLibrary({ uiLanguage = "zh-CN", targetLanguage = "zh-CN" }: TemplateLibraryProps) {
  const { templateId } = useParams<{ templateId?: string }>()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<ThemeFilter>("all")
  const [sample, setSample] = useState<TemplateSampleContent>(builtInSamples["sample-tech-zh"])
  const [sampleStatus, setSampleStatus] = useState("使用内置演示简历")
  const [savedStyles, setSavedStyles] = useState<TemplateStyleConfig[]>([])
  const [stylesLoaded, setStylesLoaded] = useState(false)
  const [styleStatus, setStyleStatus] = useState("主题已同步")
  const [editingThemeId, setEditingThemeId] = useState<string | null>(null)
  const [persistedStyles, setPersistedStyles] = useState<TemplateStyleConfig[]>([])
  const [dirtyThemeIds, setDirtyThemeIds] = useState<Set<string>>(() => new Set())
  const [isSavingStyle, setIsSavingStyle] = useState(false)

  const defaultTemplate = templateRegistry[0]
  const sampleId = defaultTemplate.sampleContentIds[targetLanguage] ?? "sample-tech-zh"
  const visibleSample = sample.id === sampleId ? sample : builtInSamples[sampleId] ?? builtInSamples["sample-tech-zh"]

  useEffect(() => {
    void getTemplateSample(sampleId)
      .then((nextSample) => {
        setSample(nextSample)
        setSampleStatus("已读取本地演示简历")
      })
      .catch(() => {
        setSample(builtInSamples[sampleId] ?? builtInSamples["sample-tech-zh"])
        setSampleStatus("使用内置演示简历")
      })
  }, [sampleId])

  useEffect(() => {
    setStylesLoaded(false)
    void listTemplateStyles()
      .then((styles) => {
        setSavedStyles(styles)
        setPersistedStyles(styles)
        setDirtyThemeIds(new Set())
        setStylesLoaded(true)
      })
      .catch(() => {
        setSavedStyles([])
        setPersistedStyles([])
        setDirtyThemeIds(new Set())
        setStylesLoaded(true)
        setStyleStatus("当前展示内置主题")
      })
  }, [])

  const themes = useMemo(
    () => buildTemplateThemes(savedStyles, uiLanguage),
    [savedStyles, uiLanguage],
  )

  const filteredThemes = useMemo(() => {
    if (filter === "all") return themes
    return themes.filter((theme) => theme.source === filter)
  }, [filter, themes])

  const selectedTheme = useMemo(
    () => themes.find((theme) => theme.id === templateId) ?? null,
    [templateId, themes],
  )
  const selectedThemeHasUnsavedChanges = Boolean(selectedTheme && dirtyThemeIds.has(selectedTheme.id))

  useEffect(() => {
    if (templateId && stylesLoaded && !selectedTheme) {
      navigate(resumePackPaths.templates, { replace: true })
    }
  }, [navigate, selectedTheme, stylesLoaded, templateId])

  const openTheme = useCallback((themeId: string) => {
    navigate(resumePackPaths.template(themeId))
  }, [navigate])

  const closeTheme = useCallback(() => {
    navigate(resumePackPaths.templates)
  }, [navigate])

  const handleStyleChange = useCallback((nextStyle: TemplateStyleConfig) => {
    setSavedStyles((current) => upsertTemplateStyle(current, nextStyle))
    setDirtyThemeIds((current) => {
      const next = new Set(current)
      next.add(nextStyle.template_id)
      return next
    })
    setStyleStatus("主题样式有未保存修改")
  }, [])

  const handleSaveCurrentTheme = useCallback(async () => {
    if (!selectedTheme || isSavingStyle) return false

    setIsSavingStyle(true)
    setStyleStatus("主题正在保存")
    try {
      const saved = await saveTemplateStyle(selectedTheme.styleConfig)
      setSavedStyles((current) => upsertTemplateStyle(current, saved))
      setPersistedStyles((current) => upsertTemplateStyle(current, saved))
      setDirtyThemeIds((current) => {
        const next = new Set(current)
        next.delete(selectedTheme.id)
        return next
      })
      setStyleStatus("主题样式已保存")
      return true
    } catch {
      setStyleStatus("主题样式保存失败，请稍后重试")
      return false
    } finally {
      setIsSavingStyle(false)
    }
  }, [isSavingStyle, selectedTheme])

  const handleDiscardStyleChanges = useCallback(() => {
    if (!selectedTheme) return

    const persistedStyle = persistedStyles.find((style) => style.template_id === selectedTheme.id)
    setSavedStyles((current) => (
      persistedStyle
        ? upsertTemplateStyle(current, persistedStyle)
        : current.filter((style) => style.template_id !== selectedTheme.id)
    ))
    setDirtyThemeIds((current) => {
      const next = new Set(current)
      next.delete(selectedTheme.id)
      return next
    })
    setStyleStatus("未保存修改已放弃")
  }, [persistedStyles, selectedTheme])

  const handleCreateTheme = useCallback(async () => {
    const customCount = savedStyles.filter((style) => !isDefaultTemplateId(style.template_id)).length
    const nextStyle: TemplateStyleConfig = {
      ...defaultClassicA4Style,
      template_id: `custom-theme-${Date.now()}`,
      name: `我的主题 ${customCount + 1}`,
      preset: "",
      blocks: { ...defaultClassicA4Style.blocks },
      updated_at: new Date().toISOString(),
    }

    setSavedStyles((current) => [nextStyle, ...current])
    setStyleStatus("主题正在创建")
    try {
      const saved = await saveTemplateStyle(nextStyle)
      setSavedStyles((current) => current.map((style) => style.template_id === nextStyle.template_id ? saved : style))
      setPersistedStyles((current) => upsertTemplateStyle(current, saved))
      openTheme(saved.template_id)
      setStyleStatus("主题已创建")
    } catch {
      setSavedStyles((current) => current.filter((style) => style.template_id !== nextStyle.template_id))
      setStyleStatus("主题创建失败，请稍后重试")
    }
  }, [openTheme, savedStyles])

  const handleResetClassicTheme = useCallback(async () => {
    const previousStyles = savedStyles
    const nextStyle = defaultClassicA4Style

    setSavedStyles((current) => upsertTemplateStyle(current, nextStyle))
    setStyleStatus("主题正在重置")
    try {
      const saved = await saveTemplateStyle(nextStyle)
      setSavedStyles((current) => upsertTemplateStyle(current, saved))
      setPersistedStyles((current) => upsertTemplateStyle(current, saved))
      setDirtyThemeIds((current) => {
        const next = new Set(current)
        next.delete(nextStyle.template_id)
        return next
      })
      setStyleStatus("主题已重置为官方默认")
    } catch {
      setSavedStyles(previousStyles)
      setStyleStatus("主题重置失败，请稍后重试")
    }
  }, [savedStyles])

  const handleRenameTheme = useCallback(async (theme: TemplateTheme, name: string) => {
    if (theme.source !== "custom") return
    const nextName = name.trim() || theme.title
    const nextStyle: TemplateStyleConfig = {
      ...theme.styleConfig,
      name: nextName,
      updated_at: new Date().toISOString(),
    }

    setSavedStyles((current) => current.map((style) => style.template_id === theme.id ? nextStyle : style))
    setStyleStatus("主题名称正在保存")
    try {
      const saved = await saveTemplateStyle(nextStyle)
      setSavedStyles((current) => current.map((style) => style.template_id === theme.id ? saved : style))
      setPersistedStyles((current) => current.map((style) => style.template_id === theme.id ? saved : style))
      setStyleStatus("主题名称已保存")
    } catch {
      setStyleStatus("主题名称保存失败，请稍后重试")
    }
  }, [])

  const handleDeleteTheme = useCallback(async (theme: TemplateTheme) => {
    if (theme.source !== "custom") return
    if (!window.confirm(`删除「${theme.title}」？`)) return

    const previousStyles = savedStyles
    setSavedStyles((current) => current.filter((style) => style.template_id !== theme.id))
    setStyleStatus("主题正在删除")
    try {
      await deleteTemplateStyle(theme.id)
      setPersistedStyles((current) => current.filter((style) => style.template_id !== theme.id))
      setDirtyThemeIds((current) => {
        const next = new Set(current)
        next.delete(theme.id)
        return next
      })
      if (templateId === theme.id) closeTheme()
      setStyleStatus("主题已删除")
    } catch {
      setSavedStyles(previousStyles)
      setStyleStatus("主题删除失败，请稍后重试")
    }
  }, [closeTheme, savedStyles, templateId])

  const handleSampleChange = useCallback((nextSample: TemplateSampleContent) => {
    setSample(nextSample)
    setSampleStatus("演示简历有未保存修改")
  }, [])

  const handleSaveSample = useCallback(async () => {
    const saved = await saveTemplateSample(visibleSample)
    setSample(saved)
    setSampleStatus("演示简历已保存")
  }, [visibleSample])

  if (selectedTheme) {
    const canResetTheme = selectedTheme.source === "default" && selectedTheme.id === defaultClassicA4Style.template_id

    return (
      <main className="box-border h-full overflow-hidden bg-background p-4 md:p-6">
        <TemplateDetail
          theme={selectedTheme}
          themes={themes}
          sample={visibleSample}
          uiLanguage={uiLanguage}
          onBack={closeTheme}
          onThemeChange={openTheme}
          onStyleChange={handleStyleChange}
          onSaveStyle={handleSaveCurrentTheme}
          onDiscardStyleChanges={handleDiscardStyleChanges}
          hasUnsavedStyleChanges={selectedThemeHasUnsavedChanges}
          isSavingStyle={isSavingStyle}
          onResetTheme={canResetTheme ? handleResetClassicTheme : undefined}
          onSampleChange={handleSampleChange}
          onSaveSample={handleSaveSample}
          sampleStatus={sampleStatus}
          styleStatus={styleStatus}
        />
      </main>
    )
  }

  if (templateId && !stylesLoaded) {
    return (
      <main className="min-h-svh bg-background p-4 md:p-6">
        <p className="m-0 text-sm text-muted-foreground" aria-live="polite">主题正在加载</p>
      </main>
    )
  }

  return (
    <main className="min-h-svh bg-background p-4 md:p-6">
      <header className="mb-5 grid gap-4">
        <div className="min-w-0">
          <h1 className="m-0 mt-1 text-2xl font-semibold tracking-normal">主题库</h1>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <ToggleGroup type="single" value={filter} onValueChange={(value) => value && setFilter(value as ThemeFilter)} aria-label="主题筛选">
            {FILTERS.map((item) => (
              <ToggleGroupItem key={item.value} value={item.value}>
                {item.label}
              </ToggleGroupItem>
            ))}
            </ToggleGroup>
            <Button type="button" onClick={handleCreateTheme}>
              <Plus data-icon="inline-start" />
              新建主题
            </Button>
          </div>
        </div>
      </header>

      <section className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <span className="text-2xl font-semibold">{themes.length}</span>
          <p className="m-0 mt-1 text-sm text-muted-foreground">全部可用主题</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <span className="text-2xl font-semibold">{themes.filter((theme) => theme.source === "custom").length}</span>
          <p className="m-0 mt-1 text-sm text-muted-foreground">本地自定义</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <span className="text-2xl font-semibold">{themes.filter((theme) => theme.source === "default").length}</span>
          <p className="m-0 mt-1 text-sm text-muted-foreground">官方默认</p>
        </div>
      </section>

      <section className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
        {filteredThemes.map((theme) => (
          <PreviewShowcaseCard
            key={theme.id}
            title={editingThemeId === theme.id ? (
              <Input
                autoFocus
                defaultValue={theme.title}
                className="mx-auto h-8 max-w-52 text-center"
                onClick={(event) => event.stopPropagation()}
                onBlur={(event) => {
                  setEditingThemeId(null)
                  void handleRenameTheme(theme, event.target.value)
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur()
                  if (event.key === "Escape") setEditingThemeId(null)
                }}
              />
            ) : (
              <button
                type="button"
                className="inline-flex max-w-full cursor-pointer items-center justify-center gap-1 rounded-sm outline-none hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50"
                onClick={() => theme.source === "custom" ? setEditingThemeId(theme.id) : openTheme(theme.id)}
              >
                <span className="truncate">{theme.title}</span>
                {theme.source === "custom" && <Pencil className="size-3.5 shrink-0" />}
              </button>
            )}
            onClick={() => openTheme(theme.id)}
            preview={<TemplatePreview sample={visibleSample} styleConfig={theme.styleConfig} />}
            floatingActions={
              <Button type="button" size="sm" onClick={() => openTheme(theme.id)}>
                编辑主题
              </Button>
            }
            menu={theme.source === "custom" && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon-sm"
                    aria-label="删除主题"
                    className="bg-card/90 shadow-sm backdrop-blur-sm"
                    onClick={() => void handleDeleteTheme(theme)}
                  >
                    <Trash2 />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>删除主题</TooltipContent>
              </Tooltip>
            )}
          />
        ))}
        {filter !== "default" && (
          <article className="grid min-h-[24rem] place-items-center rounded-lg border border-dashed border-primary/45 bg-muted/45 p-5 text-center shadow-sm transition-colors duration-200 hover:border-primary hover:bg-muted/60">
            <div className="flex max-w-52 flex-col items-center gap-3">
              <span className="flex size-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <FilePlus2 />
              </span>
              <div>
                <h2 className="m-0 text-base font-semibold">新建空白主题</h2>
                <p className="m-0 mt-1 text-sm leading-5 text-muted-foreground">从经典 A4 样式开始，进入编辑页后调整字体、颜色和段落层级。</p>
              </div>
              <Button type="button" onClick={handleCreateTheme}>
                <Plus data-icon="inline-start" />
                新建
              </Button>
            </div>
          </article>
        )}
      </section>

      <TemplateStatusText status={styleStatus} className="mt-4 text-xs text-muted-foreground" />
    </main>
  )
}
