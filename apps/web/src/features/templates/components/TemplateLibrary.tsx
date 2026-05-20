import { useCallback, useEffect, useMemo, useState } from "react"
import { deleteTemplateStyle, getTemplateSample, listTemplateStyles, saveTemplateSample, saveTemplateStyle } from "@/api"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { PreviewShowcaseCard } from "@/components/preview-showcase-card"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { FilePlus2, Pencil, Plus, Trash2 } from "lucide-react"
import type { TargetLanguage, UiLanguage } from "../../workspace/types"
import { builtInSamples, defaultClassicA4Style, templateRegistry } from "../data"
import type { TemplateSampleContent, TemplateStyleConfig } from "../types"
import { TemplatePreview } from "./TemplatePreview"
import { TemplateDetail, type ThemeDetailItem } from "./TemplateDetail"

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

function isDefaultTheme(templateId: string) {
  return templateRegistry.some((template) => template.id === templateId)
}

function fallbackThemeName(theme: TemplateStyleConfig, index: number) {
  return theme.name?.trim() || `自定义主题 ${index + 1}`
}

export function TemplateLibrary({ uiLanguage = "zh-CN", targetLanguage = "zh-CN" }: TemplateLibraryProps) {
  const [filter, setFilter] = useState<ThemeFilter>("all")
  const [sample, setSample] = useState<TemplateSampleContent>(builtInSamples["sample-tech-zh"])
  const [sampleStatus, setSampleStatus] = useState("使用内置演示简历")
  const [savedStyles, setSavedStyles] = useState<TemplateStyleConfig[]>([])
  const [styleStatus, setStyleStatus] = useState("主题已同步")
  const [selectedThemeId, setSelectedThemeId] = useState<string | null>(null)
  const [editingThemeId, setEditingThemeId] = useState<string | null>(null)

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
    void listTemplateStyles()
      .then(setSavedStyles)
      .catch(() => {
        setSavedStyles([])
        setStyleStatus("当前展示内置主题")
      })
  }, [])

  const styleMap = useMemo(() => {
    return new Map(savedStyles.map((style) => [style.template_id, style]))
  }, [savedStyles])

  const themes = useMemo<ThemeDetailItem[]>(() => {
    const defaultThemes = templateRegistry.map((template) => {
      const styleConfig = styleMap.get(template.id) ?? (
        template.id === defaultClassicA4Style.template_id ? defaultClassicA4Style : {
          ...defaultClassicA4Style,
          template_id: template.id,
          name: template.localizedName[uiLanguage],
        }
      )

      return {
        id: template.id,
        title: styleConfig.name ?? template.localizedName[uiLanguage],
        description: template.description[uiLanguage],
        source: "default" as const,
        styleConfig,
      }
    })

    const customThemes = savedStyles
      .filter((style) => !isDefaultTheme(style.template_id))
      .map((style, index) => ({
        id: style.template_id,
        title: fallbackThemeName(style, index),
        description: "从工作台或主题库保存的本地主题，可继续调整字体、颜色和段落层级。",
        source: "custom" as const,
        styleConfig: style,
      }))

    return [...customThemes, ...defaultThemes]
  }, [savedStyles, styleMap, uiLanguage])

  const filteredThemes = useMemo(() => {
    if (filter === "all") return themes
    return themes.filter((theme) => theme.source === filter)
  }, [filter, themes])

  const selectedTheme = useMemo(
    () => themes.find((theme) => theme.id === selectedThemeId) ?? null,
    [selectedThemeId, themes],
  )

  const handleStyleChange = useCallback((nextStyle: TemplateStyleConfig) => {
    setSavedStyles((current) => {
      const exists = current.some((style) => style.template_id === nextStyle.template_id)
      return exists
        ? current.map((style) => style.template_id === nextStyle.template_id ? nextStyle : style)
        : [nextStyle, ...current]
    })
    setStyleStatus("主题正在保存")
  }, [])

  const handleCreateTheme = useCallback(async () => {
    const customCount = savedStyles.filter((style) => !isDefaultTheme(style.template_id)).length
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
      setSelectedThemeId(saved.template_id)
      setStyleStatus("主题已创建")
    } catch {
      setSavedStyles((current) => current.filter((style) => style.template_id !== nextStyle.template_id))
      setStyleStatus("主题创建失败，请稍后重试")
    }
  }, [savedStyles])

  const handleRenameTheme = useCallback(async (theme: ThemeDetailItem, name: string) => {
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
      setStyleStatus("主题名称已保存")
    } catch {
      setStyleStatus("主题名称保存失败，请稍后重试")
    }
  }, [])

  const handleDeleteTheme = useCallback(async (theme: ThemeDetailItem) => {
    if (theme.source !== "custom") return
    if (!window.confirm(`删除「${theme.title}」？`)) return

    const previousStyles = savedStyles
    setSavedStyles((current) => current.filter((style) => style.template_id !== theme.id))
    setStyleStatus("主题正在删除")
    try {
      await deleteTemplateStyle(theme.id)
      if (selectedThemeId === theme.id) setSelectedThemeId(null)
      setStyleStatus("主题已删除")
    } catch {
      setSavedStyles(previousStyles)
      setStyleStatus("主题删除失败，请稍后重试")
    }
  }, [savedStyles, selectedThemeId])

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
    return (
      <main className="min-h-[calc(100svh-3rem)] bg-background p-4 md:p-6">
        <TemplateDetail
          theme={selectedTheme}
          sample={visibleSample}
          uiLanguage={uiLanguage}
          onBack={() => setSelectedThemeId(null)}
          onStyleChange={handleStyleChange}
          onSampleChange={handleSampleChange}
          onSaveSample={handleSaveSample}
          sampleStatus={sampleStatus}
        />
      </main>
    )
  }

  return (
    <main className="min-h-[calc(100svh-3rem)] bg-background p-4 md:p-6">
      <header className="mb-5 grid gap-4">
        <div className="min-w-0">
          <Breadcrumb className="mb-3">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="/">首页</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>主题库</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
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
                onClick={() => theme.source === "custom" ? setEditingThemeId(theme.id) : setSelectedThemeId(theme.id)}
              >
                <span className="truncate">{theme.title}</span>
                {theme.source === "custom" && <Pencil className="size-3.5 shrink-0" />}
              </button>
            )}
            onClick={() => setSelectedThemeId(theme.id)}
            preview={<TemplatePreview sample={visibleSample} styleConfig={theme.styleConfig} />}
            floatingActions={
              <Button type="button" size="sm" onClick={() => setSelectedThemeId(theme.id)}>
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

      <p aria-live="polite" className="mt-4 text-xs text-muted-foreground">{styleStatus}</p>
    </main>
  )
}
