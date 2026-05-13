import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ArrowLeft, Save, FileDown, Pencil } from "lucide-react"
import { ResumeRichTextEditor } from "./components/ResumeRichTextEditor"
import { RightPanel } from "./components/RightPanel"
import { AiTab } from "./components/AiTab"
import { StylePanel } from "../templates/components/style-panel/StylePanel"
import { generateWorkspaceCSS } from "../templates/style-engine/css-generator"
import { exportResumePdf, getResumeVersion, getTemplateStyle, saveTemplateStyle, updateResumeVersion } from "@/api"
import { templateRegistry, defaultClassicA4Style } from "../templates/data"
import type { ResumeDocJson, ResumeEditorChange } from "./editor"
import type { ResumeVersion, TemplateStyleConfig, BlockType } from "@typedance/contracts"

export function WorkspacePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [resume, setResume] = useState<ResumeVersion | null>(null)
  const [docJson, setDocJson] = useState<ResumeDocJson>({ type: "doc", content: [] })
  const [activeBlock, setActiveBlock] = useState<BlockType>("paragraph")
  const [styleConfig, setStyleConfig] = useState<TemplateStyleConfig>(defaultClassicA4Style)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const titleInputRef = useRef<HTMLInputElement>(null)

  // Track whether a built-in template has been forked
  const forkedRef = useRef(false)
  const forkedTemplateIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!id) return

    getResumeVersion(id)
      .then(resume => {
        setResume(resume)
        setDocJson(resume.doc_json as ResumeDocJson)
        return getTemplateStyle(resume.template_id)
      })
      .then(setStyleConfig)
      .catch(() => setStyleConfig(defaultClassicA4Style))
  }, [id])

  const cssText = useMemo(() => generateWorkspaceCSS(styleConfig.blocks ?? {}), [styleConfig])

  const handleEditorChange = useCallback((change: ResumeEditorChange) => {
    setDocJson(change.docJson)
  }, [])

  const handleSelectionUpdate = useCallback((blockName: string) => {
    const validBlocks: BlockType[] = ["heading1", "heading2", "heading3", "paragraph", "bulletList", "orderedList"]
    if (validBlocks.includes(blockName as BlockType)) {
      setActiveBlock(blockName as BlockType)
    }
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
    if (!id) return
    try {
      const result = await exportResumePdf(id)
      if (result.preview_pdf_url) {
        window.open(result.preview_pdf_url, "_blank")
      }
    } catch {
      // PDF export failed silently
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
    <div className="flex h-full">
      {/* Editor area */}
      <div className="flex flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2">
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
          <Button size="sm" onClick={handleExportPdf}>
            <FileDown className="mr-1 h-4 w-4" />导出 PDF
          </Button>
        </div>

        <div className="flex-1 overflow-auto p-8">
          <ResumeRichTextEditor
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
        styleContent={
          <StylePanel
            styleConfig={styleConfig}
            onChange={handleStyleChange}
            activeBlock={activeBlock}
            onActiveBlockChange={setActiveBlock}
            uiLanguage="zh-CN"
          />
        }
        aiContent={<AiTab />}
      />
    </div>
  )
}
