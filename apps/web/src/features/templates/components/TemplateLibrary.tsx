import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useBlocker, useLocation, useNavigate, useOutletContext, useParams } from "react-router-dom"
import { FileCheck2 } from "lucide-react"
import { deleteTemplateStyle, getTemplateSample, listTemplateStyles, saveTemplateStyle, updateRevisionDocument } from "@/api"
import type { RevisionWorkspaceChromeContext } from "@/components/SiteLayout"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useResumePackNavigation } from "../../resume-pack/ResumePackNavigation"
import { resumePackPaths } from "../../resume-pack/routes"
import type { ResumeDocJson } from "../../workspace/editor"
import type { TargetLanguage, UiLanguage } from "../../workspace/types"
import { builtInSamples, defaultClassicA4Style, templateRegistry } from "../data"
import { buildTemplateThemes, isDefaultTemplateId, type TemplateTheme } from "../theme-options"
import type { TemplateSampleContent, TemplateStyleConfig } from "../types"
import { TemplateDetail } from "./TemplateDetail"
import { TemplateSidebar } from "./TemplateSidebar"
import { DEMO_PREVIEW_ID, useTemplatePreview } from "../useTemplatePreview"

function upsertTemplateStyle(styles: TemplateStyleConfig[], nextStyle: TemplateStyleConfig) {
  return styles.some((style) => style.template_id === nextStyle.template_id)
    ? styles.map((style) => style.template_id === nextStyle.template_id ? nextStyle : style)
    : [nextStyle, ...styles]
}

export function TemplateLibrary({ uiLanguage = "zh-CN", targetLanguage = "zh-CN" }: {
  uiLanguage?: UiLanguage
  targetLanguage?: TargetLanguage
}) {
  const { templateId } = useParams<{ templateId?: string }>()
  const navigate = useNavigate()
  const { key: locationKey } = useLocation()
  const currentLocationKey = useRef<string | null>(locationKey)
  const chrome = useOutletContext<RevisionWorkspaceChromeContext>()
  const [sample, setSample] = useState<TemplateSampleContent>(builtInSamples["sample-tech-zh"])
  const [sampleStatus, setSampleStatus] = useState("使用内置演示简历")
  const [savedStyles, setSavedStyles] = useState<TemplateStyleConfig[]>([])
  const [persistedStyles, setPersistedStyles] = useState<TemplateStyleConfig[]>([])
  const [stylesLoaded, setStylesLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [styleStatus, setStyleStatus] = useState("主题已同步")
  const [dirtyThemeIds, setDirtyThemeIds] = useState<Set<string>>(() => new Set())
  const [isSavingStyle, setIsSavingStyle] = useState(false)
  const [renamingTheme, setRenamingTheme] = useState<TemplateTheme | null>(null)
  const [nameDraft, setNameDraft] = useState("")
  const [deletingTheme, setDeletingTheme] = useState<TemplateTheme | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const [saveAsName, setSaveAsName] = useState("")
  const [savedAsDestination, setSavedAsDestination] = useState<{ path: string; locationKey: string } | null>(null)
  const preview = useTemplatePreview()
  const { documentsChanged } = useResumePackNavigation()
  const sampleId = templateRegistry[0].sampleContentIds[targetLanguage] ?? "sample-tech-zh"
  const visibleSample = sample.id === sampleId ? sample : builtInSamples[sampleId]

  useEffect(() => {
    currentLocationKey.current = locationKey
    return () => { currentLocationKey.current = null }
  }, [locationKey])

  useEffect(() => {
    let cancelled = false
    void getTemplateSample(sampleId).then((nextSample) => {
      if (!cancelled) { setSample(nextSample); setSampleStatus("已读取本地演示简历") }
    }).catch(() => {
      if (!cancelled) { setSample(builtInSamples[sampleId]); setSampleStatus("使用内置演示简历") }
    })
    return () => { cancelled = true }
  }, [sampleId])

  useEffect(() => {
    let cancelled = false
    setStylesLoaded(false)
    setLoadError(false)
    void listTemplateStyles().then((styles) => {
      if (cancelled) return
      setSavedStyles(styles)
      setPersistedStyles(styles)
      setStylesLoaded(true)
    }).catch(() => { if (!cancelled) setLoadError(true) })
    return () => { cancelled = true }
  }, [refresh])

  const themes = useMemo(() => buildTemplateThemes(savedStyles, uiLanguage), [savedStyles, uiLanguage])
  const selectedId = templateId ?? defaultClassicA4Style.template_id
  const selectedTheme = themes.find((theme) => theme.id === selectedId)
  const hasUnsavedStyleChanges = dirtyThemeIds.has(selectedId)
  const blocker = useBlocker(({ currentLocation, nextLocation }) => (
    hasUnsavedStyleChanges && currentLocation.pathname !== nextLocation.pathname
  ))

  useEffect(() => {
    if (!savedAsDestination || hasUnsavedStyleChanges) return
    setSavedAsDestination(null)
    if (currentLocationKey.current === savedAsDestination.locationKey) navigate(savedAsDestination.path)
  }, [savedAsDestination, hasUnsavedStyleChanges, navigate])

  useEffect(() => {
    if (stylesLoaded && !selectedTheme) navigate(resumePackPaths.template(defaultClassicA4Style.template_id), { replace: true })
  }, [navigate, selectedTheme, stylesLoaded])

  const markSaved = useCallback((saved: TemplateStyleConfig) => {
    setSavedStyles((current) => upsertTemplateStyle(current, saved))
    setPersistedStyles((current) => upsertTemplateStyle(current, saved))
    setDirtyThemeIds((current) => { const next = new Set(current); next.delete(saved.template_id); return next })
  }, [])

  const handleSaveCurrentTheme = async () => {
    if (!selectedTheme || isSavingStyle) return false
    setIsSavingStyle(true)
    setStyleStatus("主题正在保存")
    try {
      markSaved(await saveTemplateStyle(selectedTheme.styleConfig))
      setStyleStatus("主题样式已保存")
      return true
    } catch {
      setStyleStatus("主题样式保存失败，请稍后重试")
      return false
    } finally { setIsSavingStyle(false) }
  }

  const handleDiscardStyleChanges = () => {
    const persisted = persistedStyles.find((style) => style.template_id === selectedId)
    setSavedStyles((current) => persisted ? upsertTemplateStyle(current, persisted) : current.filter((style) => style.template_id !== selectedId))
    setDirtyThemeIds((current) => { const next = new Set(current); next.delete(selectedId); return next })
    setStyleStatus("未保存修改已放弃")
  }

  const handleCreateTheme = async () => {
    if (isSavingStyle || hasUnsavedStyleChanges) return
    const requestedAtLocation = locationKey
    setIsSavingStyle(true)
    setStyleStatus("主题正在创建")
    const nextStyle: TemplateStyleConfig = {
      ...defaultClassicA4Style,
      template_id: `custom-theme-${crypto.randomUUID()}`,
      name: `我的主题 ${savedStyles.filter((style) => !isDefaultTemplateId(style.template_id)).length + 1}`,
      preset: "",
      updated_at: new Date().toISOString(),
    }
    try {
      const saved = await saveTemplateStyle(nextStyle)
      markSaved(saved)
      if (currentLocationKey.current === requestedAtLocation) {
        navigate(resumePackPaths.template(saved.template_id))
      }
      setStyleStatus("主题已创建")
    } catch { setStyleStatus("主题创建失败，请稍后重试") }
    finally { setIsSavingStyle(false) }
  }

  const handleResetClassicTheme = async () => {
    if (isSavingStyle) return
    setIsSavingStyle(true)
    setStyleStatus("主题正在重置")
    try {
      markSaved(await saveTemplateStyle(defaultClassicA4Style))
      setStyleStatus("主题已重置为官方默认")
    } catch { setStyleStatus("主题重置失败，请稍后重试") }
    finally { setIsSavingStyle(false) }
  }

  const handleSaveAsTemplate = async () => {
    if (!selectedTheme || !saveAsName.trim() || isSavingStyle) return
    setIsSavingStyle(true)
    setActionError(null)
    const requestedAtLocation = locationKey
    try {
      const saved = await saveTemplateStyle({
        ...selectedTheme.styleConfig,
        template_id: `custom-theme-${crypto.randomUUID()}`,
        name: saveAsName.trim(), preset: "", updated_at: new Date().toISOString(),
      })
      markSaved(saved)
      handleDiscardStyleChanges()
      setSaveAsOpen(false)
      setSavedAsDestination({ path: resumePackPaths.template(saved.template_id), locationKey: requestedAtLocation })
      setStyleStatus("模板已另存")
    } catch { setActionError("另存模板失败，请稍后重试。") }
    finally { setIsSavingStyle(false) }
  }

  const handleApplyTemplate = async () => {
    if (!selectedTheme || !preview.selectedDocument || preview.loading || preview.error || isSavingStyle) return
    const target = preview.selectedDocument
    setIsSavingStyle(true)
    if (hasUnsavedStyleChanges) setStyleStatus("主题正在保存")
    try {
      if (hasUnsavedStyleChanges) {
        try { markSaved(await saveTemplateStyle(selectedTheme.styleConfig)) }
        catch { setStyleStatus("主题样式保存失败，请稍后重试"); return }
      }
      await updateRevisionDocument(target.id, { template_id: selectedTheme.id })
      documentsChanged()
      setStyleStatus(`已应用到 ${target.title}`)
    } catch { setStyleStatus("模板应用失败，请稍后重试") }
    finally { setIsSavingStyle(false) }
  }

  const handleRenameTheme = async () => {
    if (!renamingTheme || !nameDraft.trim() || isSavingStyle) return
    setIsSavingStyle(true)
    setActionError(null)
    try {
      markSaved(await saveTemplateStyle({ ...renamingTheme.styleConfig, name: nameDraft.trim(), updated_at: new Date().toISOString() }))
      setRenamingTheme(null)
      setStyleStatus("主题名称已保存")
    } catch { setActionError("模板重命名失败，请稍后重试。") }
    finally { setIsSavingStyle(false) }
  }

  const handleDeleteTheme = async () => {
    if (!deletingTheme || isSavingStyle) return
    setIsSavingStyle(true)
    setActionError(null)
    try {
      await deleteTemplateStyle(deletingTheme.id)
      setSavedStyles((current) => current.filter((style) => style.template_id !== deletingTheme.id))
      setPersistedStyles((current) => current.filter((style) => style.template_id !== deletingTheme.id))
      if (deletingTheme.id === selectedId) navigate(resumePackPaths.template(defaultClassicA4Style.template_id), { replace: true })
      setDeletingTheme(null)
      setStyleStatus("主题已删除")
    } catch { setActionError("模板删除失败，请稍后重试。") }
    finally { setIsSavingStyle(false) }
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-sidebar">
      {chrome.workbenchSidebarVisible ? (
        <TemplateSidebar themes={stylesLoaded ? themes : []} selectedThemeId={selectedId} width={chrome.panels.panelLayout.left}
          busy={!stylesLoaded || isSavingStyle || hasUnsavedStyleChanges}
          onCreate={() => void handleCreateTheme()}
          onRename={(theme) => { setRenamingTheme(theme); setNameDraft(theme.title); setActionError(null) }}
          onDelete={(theme) => { setDeletingTheme(theme); setActionError(null) }} />
      ) : null}
      <main className="mr-1 mb-1 min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-border bg-background">
        {loadError ? (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <p role="alert" className="text-sm text-muted-foreground">模板加载失败，请稍后重试。</p>
            <Button variant="outline" onClick={() => setRefresh((value) => value + 1)}>重试</Button>
          </div>
        ) : !stylesLoaded || !selectedTheme ? <Skeleton aria-label="模板正在加载" className="m-4 h-12" /> : (
          <TemplateDetail key={selectedTheme.id} theme={selectedTheme} themes={themes} sample={visibleSample} uiLanguage={uiLanguage}
            onThemeChange={(id) => navigate(resumePackPaths.template(id))}
            onStyleChange={(style) => {
              setSavedStyles((current) => upsertTemplateStyle(current, style))
              setDirtyThemeIds((current) => new Set(current).add(style.template_id))
              setStyleStatus("主题样式有未保存修改")
            }}
            onSaveStyle={handleSaveCurrentTheme} hasUnsavedStyleChanges={hasUnsavedStyleChanges} isSavingStyle={isSavingStyle}
            onResetTheme={selectedTheme.id === defaultClassicA4Style.template_id ? () => void handleResetClassicTheme() : undefined}
            onSaveAsTemplate={() => { setSaveAsName(`${selectedTheme.title} 副本`); setActionError(null); setSaveAsOpen(true) }}
            previewId={preview.previewId}
            previewDocJson={preview.docJson as ResumeDocJson | undefined}
            previewLoading={preview.loading}
            previewError={preview.error ?? (preview.empty ? "这份简历还没有内容。" : null)}
            onRetryPreview={preview.retry}
            previewControls={<>
              <div className="flex items-center gap-2">
                <label htmlFor="template-preview-content" className="shrink-0 text-xs text-muted-foreground">预览内容</label>
                <Select value={preview.previewId} onValueChange={preview.setPreviewId} disabled={isSavingStyle}>
                  <SelectTrigger id="template-preview-content" size="sm" className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectGroup>
                    <SelectItem value={DEMO_PREVIEW_ID}>内置演示简历</SelectItem>
                    {preview.documents.map((document) => <SelectItem key={document.id} value={document.id}>{document.title}</SelectItem>)}
                  </SelectGroup></SelectContent>
                </Select>
              </div>
              <Button variant="outline" size="sm" className="ml-auto" disabled={!preview.selectedDocument || preview.loading || !!preview.error || isSavingStyle}
                title={hasUnsavedStyleChanges ? "保存当前模板样式并应用到所选简历" : undefined} onClick={() => void handleApplyTemplate()}>
                <FileCheck2 data-icon="inline-start" />{preview.selectedDocument ? `应用到 ${preview.selectedDocument.title}` : "选择简历后应用"}
              </Button>
            </>}
            sampleStatus={preview.isDemo ? sampleStatus : ""} styleStatus={styleStatus} />
        )}
      </main>
      <Dialog open={saveAsOpen} onOpenChange={(open) => { if (!isSavingStyle) setSaveAsOpen(open) }}>
        <DialogContent><DialogHeader><DialogTitle>另存为新模板</DialogTitle><DialogDescription>以当前样式创建独立模板，原模板保持原来的已保存样式。</DialogDescription></DialogHeader>
          <form onSubmit={(event) => { event.preventDefault(); void handleSaveAsTemplate() }}>
            <FieldGroup><Field><FieldLabel htmlFor="save-as-template-name">模板名称</FieldLabel><Input id="save-as-template-name" value={saveAsName} disabled={isSavingStyle} onChange={(event) => setSaveAsName(event.target.value)} autoFocus /></Field></FieldGroup>
            {actionError ? <p role="alert" className="mt-2 text-sm text-destructive">{actionError}</p> : null}
            <DialogFooter className="mt-4"><Button type="button" variant="outline" disabled={isSavingStyle} onClick={() => setSaveAsOpen(false)}>取消</Button><Button type="submit" disabled={!saveAsName.trim() || isSavingStyle}>创建模板</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={blocker.state === "blocked"} onOpenChange={(open) => { if (!open && !isSavingStyle) blocker.reset?.() }}>
        <DialogContent onEscapeKeyDown={(event) => { if (isSavingStyle) event.preventDefault() }} onPointerDownOutside={(event) => { if (isSavingStyle) event.preventDefault() }}>
          <DialogHeader><DialogTitle>还有未保存的主题样式</DialogTitle><DialogDescription>切换前可以保存当前模板，或放弃本次修改。</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="ghost" disabled={isSavingStyle} onClick={() => blocker.reset?.()}>继续编辑</Button>
            <Button variant="outline" disabled={isSavingStyle} onClick={() => { handleDiscardStyleChanges(); blocker.proceed?.() }}>放弃修改并切换</Button>
            <Button disabled={isSavingStyle} onClick={async () => { if (await handleSaveCurrentTheme()) blocker.proceed?.() }}>保存并切换</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={renamingTheme !== null} onOpenChange={(open) => { if (!open && !isSavingStyle) setRenamingTheme(null) }}>
        <DialogContent><DialogHeader><DialogTitle>重命名模板</DialogTitle><DialogDescription>修改模板在列表中显示的名称。</DialogDescription></DialogHeader>
          <form onSubmit={(event) => { event.preventDefault(); void handleRenameTheme() }}>
            <FieldGroup><Field><FieldLabel htmlFor="template-name">模板名称</FieldLabel><Input id="template-name" value={nameDraft} disabled={isSavingStyle} onChange={(event) => setNameDraft(event.target.value)} /></Field></FieldGroup>
            {actionError ? <p role="alert" className="mt-2 text-sm text-destructive">{actionError}</p> : null}
            <DialogFooter className="mt-4"><Button type="submit" disabled={!nameDraft.trim() || isSavingStyle}>保存名称</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={deletingTheme !== null} onOpenChange={(open) => { if (!open && !isSavingStyle) setDeletingTheme(null) }}>
        <DialogContent><DialogHeader><DialogTitle>删除模板「{deletingTheme?.title}」？</DialogTitle><DialogDescription>删除后无法恢复。</DialogDescription></DialogHeader>
          {actionError ? <p role="alert" className="text-sm text-destructive">{actionError}</p> : null}
          <DialogFooter><Button variant="outline" disabled={isSavingStyle} onClick={() => setDeletingTheme(null)}>取消</Button><Button variant="destructive" disabled={isSavingStyle} onClick={() => void handleDeleteTheme()}>删除模板</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
