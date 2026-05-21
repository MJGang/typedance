import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ArrowLeft, Save, FileDown, FileCode, Pencil } from "lucide-react"
import { ResumeRichTextEditor, type ResumeRichTextEditorHandle, type ResumeSelectionContext } from "./components/ResumeRichTextEditor"
import { RightPanel } from "./components/RightPanel"
import { AiTab } from "./components/AiTab"
import { StylePanel } from "../templates/components/style-panel/StylePanel"
import { generateWorkspaceCSS } from "../templates/style-engine/css-generator"
import { exportResumeHtml, exportResumePdf, getResumeVersion, getTemplateStyle, listTemplateStyles, saveTemplateStyle, updateResumeVersion } from "@/api"
import { templateRegistry, defaultClassicA4Style } from "../templates/data"
import { ExportStatusBar, type ExportStatusType } from "./components/ExportStatusBar"
import { isTauri, openFileInTauri } from "@/tauri"
import type { ResumeDocJson, ResumeEditorChange } from "./editor"
import type { ResumeVersion, TemplateStyleConfig, BlockType } from "@typedance/contracts"
import type { ColumnsCount, ColumnsGap } from "@typedance/tiptap-layout"

export function WorkspacePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [resume, setResume] = useState<ResumeVersion | null>(null)
  const [docJson, setDocJson] = useState<ResumeDocJson>({ type: "doc", content: [] })
  const [activeBlock, setActiveBlock] = useState<BlockType>("paragraph")
  const [styleConfig, setStyleConfig] = useState<TemplateStyleConfig>(defaultClassicA4Style)
  const [savedStyles, setSavedStyles] = useState<TemplateStyleConfig[]>([])
  const [selectedThemeId, setSelectedThemeId] = useState(defaultClassicA4Style.template_id)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<ResumeRichTextEditorHandle>(null)
  const [exportStatus, setExportStatus] = useState<ExportStatusType>({ type: "idle" })
  const lastExportPathRef = useRef<string | null>(null)
  const [activeColumnsCount, setActiveColumnsCount] = useState<ColumnsCount | null>(null)
  const [activeColumnsGap, setActiveColumnsGap] = useState<ColumnsGap | null>(null)

  // Track whether a built-in template has been forked
  const forkedRef = useRef(false)
  const forkedTemplateIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!id) return

    getResumeVersion(id)
      .then(resume => {
        setResume(resume)
        setDocJson(resume.doc_json as ResumeDocJson)
        setSelectedThemeId(resume.template_id)
        return getTemplateStyle(resume.template_id)
      })
      .then(setStyleConfig)
      .catch(() => setStyleConfig(defaultClassicA4Style))
  }, [id])

  useEffect(() => {
    void listTemplateStyles()
      .then(setSavedStyles)
      .catch(() => setSavedStyles([]))
  }, [])

  const styleMap = useMemo(() => {
    return new Map(savedStyles.map((style) => [style.template_id, style]))
  }, [savedStyles])

  const themeOptions = useMemo(() => {
    const defaultThemes = templateRegistry.map((template) => {
      const style = styleMap.get(template.id) ?? (
        template.id === defaultClassicA4Style.template_id ? defaultClassicA4Style : {
          ...defaultClassicA4Style,
          template_id: template.id,
          name: template.localizedName["zh-CN"],
        }
      )

      return {
        id: template.id,
        title: style.name?.trim() || template.localizedName["zh-CN"],
        source: "default" as const,
        styleConfig: style,
      }
    })

    const customThemes = savedStyles
      .filter((style) => !templateRegistry.some((template) => template.id === style.template_id))
      .map((style, index) => ({
        id: style.template_id,
        title: style.name?.trim() || `自定义主题 ${index + 1}`,
        source: "custom" as const,
        styleConfig: style,
      }))

    const themes = [...customThemes, ...defaultThemes]
    if (styleConfig.template_id && !themes.some((theme) => theme.id === styleConfig.template_id)) {
      themes.unshift({
        id: styleConfig.template_id,
        title: styleConfig.name?.trim() || "当前主题",
        source: "custom" as const,
        styleConfig,
      })
    }

    return themes
  }, [savedStyles, styleConfig, styleMap])

  const cssText = useMemo(() => generateWorkspaceCSS(styleConfig.blocks ?? {}), [styleConfig])

  const handleEditorChange = useCallback((change: ResumeEditorChange) => {
    setDocJson(change.docJson)
  }, [])

  const handleSelectionUpdate = useCallback((blockName: string, context?: ResumeSelectionContext) => {
    setActiveColumnsCount(context?.columns?.count ?? null)
    setActiveColumnsGap(context?.columns?.gap ?? null)

    const validBlocks: BlockType[] = ["heading1", "heading2", "heading3", "paragraph", "bulletList", "orderedList"]
    if (validBlocks.includes(blockName as BlockType)) {
      setActiveBlock(blockName as BlockType)
    }
  }, [])

  const handleColumnsCountChange = useCallback((count: ColumnsCount) => {
    editorRef.current?.setColumnsCount(count)
    setActiveColumnsCount(count)
  }, [])

  const handleColumnsGapChange = useCallback((gap: ColumnsGap) => {
    editorRef.current?.setColumnsGap(gap)
    setActiveColumnsGap(gap)
  }, [])

  const handleUnsetColumns = useCallback(() => {
    editorRef.current?.unsetColumns()
    setActiveColumnsCount(null)
    setActiveColumnsGap(null)
  }, [])

  const handleStyleChange = useCallback((newStyle: TemplateStyleConfig) => {
    setStyleConfig(newStyle)
    // Template fork: if modifying a built-in template, save as a new user template
    const template = resume ? templateRegistry.find(t => t.id === resume.template_id) : null
    if (template?.status === "built-in" && !forkedRef.current) {
      forkedRef.current = true
      const newId = `user_${resume!.template_id}_${Date.now()}`
      forkedTemplateIdRef.current = newId
      saveTemplateStyle({ ...newStyle, template_id: newId, name: template.localizedName["zh-CN"], preset: "" }).catch(console.error)
    } else {
      const targetId = forkedTemplateIdRef.current ?? newStyle.template_id
      saveTemplateStyle({ ...newStyle, template_id: targetId }).catch(console.error)
    }
  }, [resume])

  const handleThemeChange = useCallback((themeId: string) => {
    const theme = themeOptions.find((item) => item.id === themeId)
    if (!theme) return

    setSelectedThemeId(theme.id)
    setStyleConfig(theme.styleConfig)

    if (!id || !resume || resume.template_id === theme.id) return

    const previousResume = resume
    setResume({ ...resume, template_id: theme.id })
    updateResumeVersion(id, { template_id: theme.id })
      .then(setResume)
      .catch(() => {
        setResume(previousResume)
        toast.error("主题切换保存失败", {
          description: "当前简历仍保留原主题，请稍后重试。",
          duration: 4000,
        })
      })
  }, [id, resume, themeOptions])

  const startEditing = useCallback(() => {
    setTitleDraft(resume?.title ?? "")
    setEditingTitle(true)
  }, [resume])

  const commitTitle = useCallback(() => {
    const trimmed = titleDraft.trim()
    if (!trimmed || trimmed === resume?.title) {
      setEditingTitle(false)
      return trimmed === resume?.title ? resume?.title : null
    }
    return trimmed
  }, [titleDraft, resume])

  const cancelEditing = useCallback(() => {
    setEditingTitle(false)
  }, [])

  const handleSave = useCallback(async () => {
    if (!id || !resume || isSaving) return

    setIsSaving(true)

    const updates: Record<string, unknown> = {
      doc_json: docJson as Record<string, unknown>,
    }

    const title = editingTitle ? commitTitle() : null
    if (title) {
      updates.title = title
    }

    try {
      const updated = await updateResumeVersion(id, updates)
      setResume(updated)
    } catch {
      // Save failed — doc_json stays in local state so user can retry
    }

    setEditingTitle(false)
    setIsSaving(false)
  }, [id, resume, docJson, editingTitle, isSaving, commitTitle])

  const handleExportPdf = useCallback(async () => {
    if (!id || !resume) return
    setExportStatus({ type: "exporting" })
    try {
      const result = await exportResumePdf(id, resume.title)
      if (!result) {
        // 用户取消了文件选择
        setExportStatus({ type: "idle" })
        return
      }
      setExportStatus({ type: "saved", fileName: result.fileName })
      lastExportPathRef.current = result.filePath ?? null
      toast.success("PDF 导出成功", {
        description: `已保存为 ${result.fileName}`,
        duration: 4000,
      })
    } catch {
      setExportStatus({ type: "error", message: "请检查 Sidecar 服务是否正常运行" })
      toast.error("PDF 导出失败", {
        description: "请检查 Sidecar 服务是否正常运行",
        duration: 4000,
      })
    }
  }, [id, resume])

  const handleExportHtml = useCallback(async () => {
    if (!id || !resume) return
    try {
      const result = await exportResumeHtml(id, resume.title)
      if (!result) return
      toast.success("HTML export succeeded", {
        description: `Saved as ${result.fileName}`,
        duration: 4000,
      })
    } catch {
      toast.error("HTML export failed", {
        description: "Check whether the Sidecar service is running.",
        duration: 4000,
      })
    }
  }, [id, resume])

  const handleOpenPdf = useCallback(() => {
    if (isTauri() && lastExportPathRef.current) {
      openFileInTauri(lastExportPathRef.current)
    } else if (id) {
      window.open(`http://127.0.0.1:4317/previews/${id}.pdf`, "_blank")
    }
  }, [id])

  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus()
      titleInputRef.current.select()
    }
  }, [editingTitle])

  // If no resume id is available, show a message
  if (!id) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-lg text-muted-foreground">未找到简历</p>
          <Button className="mt-4" onClick={() => navigate("/")}>
            返回首页
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100svh-3rem)] min-h-0 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Editor area */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            {editingTitle ? (
              <Input
                ref={titleInputRef}
                className="flex-1 h-7 text-sm font-medium"
                value={titleDraft}
                onChange={e => setTitleDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") handleSave()
                  if (e.key === "Escape") cancelEditing()
                }}
              />
            ) : (
              <h2
                className="group flex flex-1 cursor-pointer items-center gap-1.5 text-sm font-medium transition-colors duration-150 hover:text-primary"
                onClick={startEditing}
              >
                <span className="truncate">{resume?.title ?? "加载中..."}</span>
                <Pencil className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
              </h2>
            )}
            <Button variant="outline" size="sm" onClick={handleSave} disabled={isSaving}>
              <Save className="mr-1 h-4 w-4" />{isSaving ? "保存中..." : "保存"}
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportHtml}>
              <FileCode className="mr-1 h-4 w-4" />导出 HTML
            </Button>
            <Button size="sm" onClick={handleExportPdf} disabled={exportStatus.type === "exporting"}>
              <FileDown className="mr-1 h-4 w-4" />{exportStatus.type === "exporting" ? "导出中..." : "导出 PDF"}
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden px-8">
            <ResumeRichTextEditor
              ref={editorRef}
              ariaLabel="Resume editor"
              docJson={docJson}
              onChange={handleEditorChange}
              onSelectionUpdate={handleSelectionUpdate}
              cssText={cssText}
            />
          </div>
        </div>

        {/* Right panel */}
        <RightPanel
          designContent={
            <StylePanel
              styleConfig={styleConfig}
              selectedThemeId={selectedThemeId}
              themeOptions={themeOptions}
              onChange={handleStyleChange}
              onThemeChange={handleThemeChange}
              activeBlock={activeBlock}
              onActiveBlockChange={setActiveBlock}
              activeColumnsCount={activeColumnsCount}
              activeColumnsGap={activeColumnsGap}
              onActiveColumnsCountChange={handleColumnsCountChange}
              onActiveColumnsGapChange={handleColumnsGapChange}
              onUnsetColumns={handleUnsetColumns}
              uiLanguage="zh-CN"
            />
          }
          aiContent={<AiTab />}
        />
      </div>
      <ExportStatusBar status={exportStatus} onOpenPdf={handleOpenPdf} />
    </div>
  )
}
