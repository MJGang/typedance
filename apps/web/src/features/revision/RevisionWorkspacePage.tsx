import { useCallback, useEffect, useRef, useState } from "react"
import { useOutletContext, useParams } from "react-router-dom"
import { AlertCircle, Download, FileText, Loader2, PanelRight, RefreshCcw, SquarePen } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Field, FieldDescription, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import {
  exportRevisionDocumentHtml,
  exportRevisionDocumentPdf,
  getRevisionWorkspaceView,
  updateRevisionDocument,
} from "@/api"
import { updateWorkspaceConversation } from "@/agentHost"
import { AgentChatPanel } from "./AgentChatPanel"
import { DraftCanvas, type CanvasPatchFlash } from "./DraftCanvas"
import { DEFAULT_SOURCE_CANVAS_PAGE_MARGINS, type PageMargins } from "./pageMargins"
import { defaultClassicA4Style } from "../templates/data"
import { useSourceCanvasAutosave } from "./useSourceCanvasAutosave"
import { WorkbenchSidebar } from "./WorkbenchSidebar"
import type { RevisionWorkspaceChromeContext } from "@/components/SiteLayout"
import type { AgentConversation, AgentRunEvent, ContextSource, SourceResumeCanvas, WorkspaceView } from "@typedance/contracts"

type LoadState =
  | { status: "loading" }
  | { status: "loaded"; workspace: WorkspaceView }
  | { status: "error"; message: string }

type RevisionExportFormat = "pdf" | "html"

const SOURCE_CANVAS_TEXT_CURSOR_CLASS = "td-source-canvas-cursor-text"
const WORKSPACE_TITLE_MAX_LENGTH = 10

function limitWorkspaceTitle(value: string) {
  return Array.from(value).slice(0, WORKSPACE_TITLE_MAX_LENGTH).join("")
}

function stringArrayFromPayload(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.length > 0)
}

function patchFlashFromRunEvent(event: AgentRunEvent, sequence: number): CanvasPatchFlash {
  const changedBlocks = Array.isArray(event.payload.changed_blocks) ? event.payload.changed_blocks : []
  const sourceBlockIds = changedBlocks
    .map((block) => (
      block && typeof block === "object" && "block_id" in block
        ? (block as { block_id?: unknown }).block_id
        : null
    ))
    .filter((blockId): blockId is string => typeof blockId === "string" && blockId.length > 0)
  return {
    sequence,
    canvasNodeIds: stringArrayFromPayload(event.payload, "changed_canvas_node_ids"),
    sourceBlockIds: [
      ...sourceBlockIds,
      ...stringArrayFromPayload(event.payload, "changed_source_block_ids"),
    ],
    moduleIds: stringArrayFromPayload(event.payload, "changed_module_ids"),
  }
}

function mergeLatestSavedCanvas(workspace: WorkspaceView, latestSavedCanvas: SourceResumeCanvas | null) {
  if (!latestSavedCanvas || latestSavedCanvas.document_id !== workspace.document.id) return workspace
  return {
    ...workspace,
    source_resume_canvas: latestSavedCanvas,
  }
}

export function RevisionWorkspacePage() {
  const { documentId } = useParams<{ documentId: string }>()
  const chromeContext = useOutletContext<Partial<RevisionWorkspaceChromeContext> | undefined>()
  const assistantPanelVisible = chromeContext?.assistantPanelVisible ?? true
  const setAssistantPanelVisible = chromeContext?.setAssistantPanelVisible
  const workbenchSidebarVisible = chromeContext?.workbenchSidebarVisible ?? true
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [exportingFormat, setExportingFormat] = useState<RevisionExportFormat | null>(null)
  const [sourceCanvasPageMargins, setSourceCanvasPageMargins] = useState<PageMargins | null>(null)
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [titleDraft, setTitleDraft] = useState("")
  const [titleSaveError, setTitleSaveError] = useState<string | null>(null)
  const [isSavingTitle, setIsSavingTitle] = useState(false)
  const [activeConversationId, setActiveConversationId] = useState<string | undefined>()
  const [conversations, setConversations] = useState<AgentConversation[]>([])
  const [renamingConversation, setRenamingConversation] = useState<AgentConversation | null>(null)
  const [conversationNameDraft, setConversationNameDraft] = useState("")
  const [savingConversationName, setSavingConversationName] = useState(false)
  const [conversationRefreshToken, setConversationRefreshToken] = useState(0)
  const [contextSources, setContextSources] = useState<ContextSource[]>([])
  const [canvasPatchFlash, setCanvasPatchFlash] = useState<CanvasPatchFlash | null>(null)
  const canvasPatchFlashSequenceRef = useRef(0)
  const mountedRef = useRef(false)
  const currentDocumentIdRef = useRef(documentId)
  const latestSavedCanvasRef = useRef<SourceResumeCanvas | null>(null)
  const loadRequestEpochRef = useRef(0)
  const renameRequestEpochRef = useRef(0)
  const draftPanelRef = useRef<HTMLDivElement>(null)
  const titleSaveInFlightRef = useRef(false)
  currentDocumentIdRef.current = documentId

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      loadRequestEpochRef.current += 1
      renameRequestEpochRef.current += 1
    }
  }, [])

  useEffect(() => {
    renameRequestEpochRef.current += 1
    titleSaveInFlightRef.current = false
    setRenameDialogOpen(false)
    setTitleDraft("")
    setTitleSaveError(null)
    setIsSavingTitle(false)
  }, [documentId])

  const handleSavedCanvas = useCallback((savedCanvas: SourceResumeCanvas) => {
    latestSavedCanvasRef.current = savedCanvas
    if (!mountedRef.current || currentDocumentIdRef.current !== savedCanvas.document_id) return
    setState((currentState) => {
      if (currentState.status !== "loaded" || currentState.workspace.document.id !== savedCanvas.document_id) {
        return currentState
      }
      return {
        status: "loaded",
        workspace: {
          ...currentState.workspace,
          source_resume_canvas: savedCanvas,
        },
      }
    })
  }, [])

  const handleCanvasPatchApplied = useCallback((event: AgentRunEvent) => {
    canvasPatchFlashSequenceRef.current += 1
    setCanvasPatchFlash(patchFlashFromRunEvent(event, canvasPatchFlashSequenceRef.current))
  }, [])

  const refreshConversations = useCallback(() => {
    setConversationRefreshToken((current) => current + 1)
  }, [])

  const handleConversationCreated = useCallback((conversationId: string) => {
    setActiveConversationId(conversationId)
    refreshConversations()
  }, [refreshConversations])

  const handleSelectConversation = useCallback((conversationId: string) => {
    setActiveConversationId(conversationId)
    setAssistantPanelVisible?.(true)
  }, [setAssistantPanelVisible])

  const handleStartNewConversation = useCallback(() => {
    setActiveConversationId(undefined)
    setAssistantPanelVisible?.(true)
  }, [setAssistantPanelVisible])

  const handleConversationsChange = useCallback((nextConversations: AgentConversation[]) => {
    setConversations(nextConversations)
    setActiveConversationId((currentConversationId) => (
      currentConversationId && nextConversations.some((conversation) => conversation.id === currentConversationId)
        ? currentConversationId
        : undefined
    ))
  }, [])

  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId)

  const handleToggleActiveConversationPinned = useCallback(async () => {
    if (!activeConversation) return
    try {
      await updateWorkspaceConversation(activeConversation.id, { pinned: !activeConversation.pinned })
      refreshConversations()
    } catch {
      toast.error("更新对话置顶状态失败")
    }
  }, [activeConversation, refreshConversations])

  const openConversationRenameDialog = useCallback(() => {
    if (!activeConversation) return
    setRenamingConversation(activeConversation)
    setConversationNameDraft(conversationDisplayTitle(activeConversation) ?? "")
  }, [activeConversation])

  const saveConversationName = useCallback(async () => {
    if (!renamingConversation || savingConversationName) return
    const name = conversationNameDraft.trim()
    if (!name) return
    setSavingConversationName(true)
    try {
      await updateWorkspaceConversation(renamingConversation.id, { name })
      setRenamingConversation(null)
      setConversationNameDraft("")
      refreshConversations()
    } catch {
      toast.error("重命名对话失败")
    } finally {
      setSavingConversationName(false)
    }
  }, [conversationNameDraft, refreshConversations, renamingConversation, savingConversationName])

  const {
    flush: flushCanvasSaves,
    handleChange: handleCanvasChange,
    latestSavedCanvas,
    localDocJson: localCanvasDocJson,
    retry: retryCanvasSave,
    saveStatus: canvasSaveStatus,
  } = useSourceCanvasAutosave(documentId, handleSavedCanvas)
  if (latestSavedCanvas?.document_id === documentId) {
    latestSavedCanvasRef.current = latestSavedCanvas
  }

  const loadWorkspace = useCallback(async () => {
    if (!documentId) return
    const capturedDocumentId = documentId
    const requestEpoch = ++loadRequestEpochRef.current
    await flushCanvasSaves()
    if (
      !mountedRef.current
      || requestEpoch !== loadRequestEpochRef.current
      || currentDocumentIdRef.current !== capturedDocumentId
    ) return

    setState((currentState) => currentState.status === "loaded" ? currentState : { status: "loading" })
    try {
      const workspace = await getRevisionWorkspaceView(capturedDocumentId)
      if (
        !mountedRef.current
        || requestEpoch !== loadRequestEpochRef.current
        || currentDocumentIdRef.current !== capturedDocumentId
      ) return
      setState({ status: "loaded", workspace: mergeLatestSavedCanvas(workspace, latestSavedCanvasRef.current) })
    } catch {
      if (
        !mountedRef.current
        || requestEpoch !== loadRequestEpochRef.current
        || currentDocumentIdRef.current !== capturedDocumentId
      ) return
      setState({ status: "error", message: "无法加载工作台，请检查 Sidecar 服务。" })
    }
  }, [documentId, flushCanvasSaves])

  useEffect(() => {
    if (!documentId) return
    const capturedDocumentId = documentId
    latestSavedCanvasRef.current = latestSavedCanvas?.document_id === capturedDocumentId ? latestSavedCanvas : null
    const requestEpoch = ++loadRequestEpochRef.current
    setState({ status: "loading" })
    setActiveConversationId(undefined)
    setConversations([])
    setContextSources([])
    void (async () => {
      await flushCanvasSaves()
      if (
        !mountedRef.current
        || requestEpoch !== loadRequestEpochRef.current
        || currentDocumentIdRef.current !== capturedDocumentId
      ) return
      try {
        const workspace = await getRevisionWorkspaceView(capturedDocumentId)
        if (
          mountedRef.current
          && requestEpoch === loadRequestEpochRef.current
          && currentDocumentIdRef.current === capturedDocumentId
        ) {
          setState({ status: "loaded", workspace: mergeLatestSavedCanvas(workspace, latestSavedCanvasRef.current) })
        }
      } catch {
        if (
          mountedRef.current
          && requestEpoch === loadRequestEpochRef.current
          && currentDocumentIdRef.current === capturedDocumentId
        ) {
          setState({ status: "error", message: "无法加载工作台，请检查 Sidecar 服务。" })
        }
      }
    })()
    return () => {
      loadRequestEpochRef.current += 1
    }
  }, [documentId, flushCanvasSaves])

  const workspace = state.status === "loaded" && state.workspace.document.id === documentId ? state.workspace : null
  const sourceCanvas = workspace?.source_resume_canvas
    ? {
        ...workspace.source_resume_canvas,
        doc_json: localCanvasDocJson ?? workspace.source_resume_canvas.doc_json,
      }
    : undefined

  const handleExport = useCallback(async (format: RevisionExportFormat) => {
    if (!workspace || !sourceCanvas || exportingFormat) return
    setExportingFormat(format)
    try {
      const exportDocument = format === "pdf" ? exportRevisionDocumentPdf : exportRevisionDocumentHtml
      const result = await exportDocument(workspace.document.id, workspace.document.title, {
        docJson: sourceCanvas.doc_json as Record<string, unknown>,
        pageMargins: sourceCanvasPageMargins ?? DEFAULT_SOURCE_CANVAS_PAGE_MARGINS,
        templateStyle: defaultClassicA4Style,
      })
      if (!result) return
      toast.success(`${format === "pdf" ? "PDF" : "HTML"} 导出成功`, {
        description: `已保存为 ${result.fileName}`,
        duration: 4000,
      })
    } catch {
      toast.error(`${format === "pdf" ? "PDF" : "HTML"} 导出失败`, {
        description: "请检查 Sidecar 服务是否正常运行",
        duration: 4000,
      })
    } finally {
      setExportingFormat(null)
    }
  }, [exportingFormat, sourceCanvas, sourceCanvasPageMargins, workspace])

  const openRenameDialog = useCallback(() => {
    if (!workspace || isSavingTitle) return
    setTitleDraft(workspace.document.title)
    setTitleSaveError(null)
    setRenameDialogOpen(true)
  }, [isSavingTitle, workspace])

  const cancelRenameDialog = useCallback(() => {
    renameRequestEpochRef.current += 1
    titleSaveInFlightRef.current = false
    setTitleDraft(workspace?.document.title ?? "")
    setTitleSaveError(null)
    setIsSavingTitle(false)
    setRenameDialogOpen(false)
  }, [workspace])

  const saveWorkspaceTitle = useCallback(async () => {
    if (!workspace) return
    if (titleSaveInFlightRef.current) return

    const trimmed = limitWorkspaceTitle(titleDraft.trim())
    if (!trimmed || trimmed === workspace.document.title) {
      setTitleDraft(workspace.document.title)
      setTitleSaveError(null)
      setRenameDialogOpen(false)
      return
    }

    titleSaveInFlightRef.current = true
    const capturedDocumentId = workspace.document.id
    const requestEpoch = ++renameRequestEpochRef.current
    setIsSavingTitle(true)
    setTitleSaveError(null)

    const requestIsCurrent = () => (
      mountedRef.current
      && currentDocumentIdRef.current === capturedDocumentId
      && renameRequestEpochRef.current === requestEpoch
    )

    try {
      const updatedDocument = await updateRevisionDocument(capturedDocumentId, { title: trimmed })
      if (!requestIsCurrent() || updatedDocument.id !== capturedDocumentId) return
      setState((currentState) => {
        if (currentState.status !== "loaded" || currentState.workspace.document.id !== updatedDocument.id) {
          return currentState
        }
        return {
          status: "loaded",
          workspace: {
            ...currentState.workspace,
            document: updatedDocument,
          },
        }
      })
      setTitleDraft(updatedDocument.title)
      setRenameDialogOpen(false)
    } catch {
      if (!requestIsCurrent()) return
      setTitleSaveError("标题保存失败，请稍后重试。")
      setRenameDialogOpen(true)
    } finally {
      if (requestIsCurrent()) {
        titleSaveInFlightRef.current = false
        setIsSavingTitle(false)
      }
    }
  }, [titleDraft, workspace])

  useEffect(() => {
    const syncSourceCanvasCursor = (event: PointerEvent) => {
      const panel = draftPanelRef.current
      if (!panel) {
        document.body.classList.remove(SOURCE_CANVAS_TEXT_CURSOR_CLASS)
        return
      }

      const rect = panel.getBoundingClientRect()
      const insideDraftPanel = (
        event.clientX >= rect.left
        && event.clientX <= rect.right
        && event.clientY >= rect.top
        && event.clientY <= rect.bottom
      )
      document.body.classList.toggle(SOURCE_CANVAS_TEXT_CURSOR_CLASS, insideDraftPanel)
    }
    const clearSourceCanvasCursor = () => {
      document.body.classList.remove(SOURCE_CANVAS_TEXT_CURSOR_CLASS)
    }

    document.addEventListener("pointermove", syncSourceCanvasCursor, true)
    document.addEventListener("pointerdown", syncSourceCanvasCursor, true)
    window.addEventListener("blur", clearSourceCanvasCursor)

    return () => {
      document.removeEventListener("pointermove", syncSourceCanvasCursor, true)
      document.removeEventListener("pointerdown", syncSourceCanvasCursor, true)
      window.removeEventListener("blur", clearSourceCanvasCursor)
      clearSourceCanvasCursor()
    }
  }, [])

  if (!documentId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-muted-foreground">缺少文档 ID。</p>
      </div>
    )
  }

  if (state.status === "loading") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        <span className="text-sm text-muted-foreground">加载工作台</span>
      </div>
    )
  }

  if (state.status === "error") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-6">
        <div className="max-w-sm text-center">
          <AlertCircle className="mx-auto mb-3 h-5 w-5 text-destructive" />
          <p className="text-sm text-muted-foreground">{state.message}</p>
          <Button className="mt-4" variant="outline" onClick={loadWorkspace}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            重试
          </Button>
        </div>
      </div>
    )
  }

  if (!workspace) return null
  const exportDisabled = !sourceCanvas || exportingFormat !== null
  const exportTitlebarAction = (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="导出"
              disabled={exportDisabled}
            >
              {exportingFormat ? <Loader2 className="animate-spin" /> : <Download />}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>导出</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem disabled={exportDisabled} onSelect={() => void handleExport("pdf")}>
            <Download />
            导出 PDF
          </DropdownMenuItem>
          <DropdownMenuItem disabled={exportDisabled} onSelect={() => void handleExport("html")}>
            <FileText />
            导出 HTML
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-background">
      {workbenchSidebarVisible ? (
        <WorkbenchSidebar
          workspaceId={workspace.document.id}
          activeConversationId={activeConversationId}
          conversationRefreshToken={conversationRefreshToken}
          onSelectConversation={handleSelectConversation}
          onStartNewConversation={handleStartNewConversation}
          onContextSourcesChange={setContextSources}
          onConversationsChange={handleConversationsChange}
        />
      ) : null}
      <main
        data-testid="revision-workspace-grid"
        className={cn(
          "relative mr-1 mb-1 grid min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-border bg-background",
          assistantPanelVisible
            ? "grid-cols-[minmax(0,1fr)_24rem]"
            : "grid-cols-[minmax(0,1fr)]",
        )}
      >
        <section data-testid="revision-draft-column" className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <div
            data-testid="revision-workspace-titlebar"
            className="flex h-12 shrink-0 items-center border-b border-border bg-background px-3"
          >
            <div className="flex min-w-0 items-center gap-1">
              <h1 className="truncate text-sm font-semibold">{workspace.document.title}</h1>
              <Button type="button" variant="ghost" size="icon-xs" aria-label="重命名工作区" onClick={openRenameDialog}>
                <SquarePen />
              </Button>
            </div>
            <div data-testid="revision-workspace-actions" className="ml-auto flex items-center gap-1">
              {exportTitlebarAction}
              {!assistantPanelVisible ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="显示 AI 面板"
                      onClick={() => setAssistantPanelVisible?.(true)}
                    >
                      <PanelRight data-icon-name="panel-right" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>显示 AI 面板</TooltipContent>
                </Tooltip>
              ) : null}
            </div>
          </div>
          <div
            ref={draftPanelRef}
            data-testid="revision-draft-panel"
            className="td-source-resume-canvas-viewport min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden overscroll-x-contain bg-background px-0 pt-0"
          >
            <div className="h-full w-full min-w-[56rem] max-w-none">
              {sourceCanvas ? (
                <DraftCanvas
                  canvas={sourceCanvas}
                  patchFlash={canvasPatchFlash}
                  onChange={handleCanvasChange}
                  onPageMarginsChange={setSourceCanvasPageMargins}
                  onRetrySave={retryCanvasSave}
                  saveStatus={canvasSaveStatus}
                  templateStyle={defaultClassicA4Style}
                />
              ) : (
                <div className="m-4 rounded-md border border-border bg-muted/30 p-4">
                  <p className="text-sm font-medium">原始画布尚未生成</p>
                </div>
              )}
            </div>
          </div>
        </section>
        {assistantPanelVisible ? (
          <AgentChatPanel
            workspaceId={workspace.document.id}
            activeConversationId={activeConversation?.id}
            activeConversationTitle={conversationDisplayTitle(activeConversation)}
            activeConversationPinned={activeConversation?.pinned}
            contextSources={contextSources}
            onConversationCreated={handleConversationCreated}
            onConversationUpdated={refreshConversations}
            onToggleConversationPinned={handleToggleActiveConversationPinned}
            onRenameConversation={openConversationRenameDialog}
            onCanvasPatchApplied={handleCanvasPatchApplied}
            onHide={() => setAssistantPanelVisible?.(false)}
          />
        ) : null}
      </main>
      <Dialog open={renamingConversation !== null} onOpenChange={(open) => {
        if (!open && !savingConversationName) {
          setRenamingConversation(null)
          setConversationNameDraft("")
        }
      }}>
        <DialogContent showCloseButton={!savingConversationName}>
          <DialogHeader>
            <DialogTitle>重命名对话</DialogTitle>
            <DialogDescription>保持简短且易于识别</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            aria-label="对话名称"
            value={conversationNameDraft}
            onChange={(event) => setConversationNameDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void saveConversationName()
            }}
          />
          <DialogFooter>
            <Button variant="outline" disabled={savingConversationName} onClick={() => setRenamingConversation(null)}>取消</Button>
            <Button disabled={!conversationNameDraft.trim() || savingConversationName} onClick={() => void saveConversationName()}>
              {savingConversationName ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={renameDialogOpen}
        onOpenChange={(open) => {
          if (!open && !isSavingTitle) cancelRenameDialog()
        }}
      >
        <DialogContent
          showCloseButton={!isSavingTitle}
          onEscapeKeyDown={(event) => {
            if (isSavingTitle) event.preventDefault()
          }}
          onPointerDownOutside={(event) => {
            if (isSavingTitle) event.preventDefault()
          }}
        >
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              void saveWorkspaceTitle()
            }}
          >
            <DialogHeader>
              <DialogTitle>重命名工作区</DialogTitle>
              <DialogDescription>输入新的工作区标题，最多 10 个字符。</DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Field data-invalid={titleSaveError ? true : undefined}>
                <Input
                  aria-label="工作区标题"
                  aria-errormessage={titleSaveError ? "workspace-title-error" : undefined}
                  aria-invalid={titleSaveError ? true : undefined}
                  autoFocus
                  disabled={isSavingTitle}
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(limitWorkspaceTitle(event.target.value))}
                />
                <FieldDescription className="flex justify-between gap-2" aria-live="polite">
                  {titleSaveError ? (
                    <span id="workspace-title-error" role="alert" className="text-destructive">
                      {titleSaveError}
                    </span>
                  ) : <span />}
                  <span className="ml-auto shrink-0 tabular-nums">{Array.from(titleDraft).length}/10</span>
                </FieldDescription>
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={isSavingTitle} onClick={cancelRenameDialog}>
                取消
              </Button>
              <Button type="submit" disabled={isSavingTitle}>
                {isSavingTitle ? "保存中" : "保存"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function conversationDisplayTitle(conversation: AgentConversation | undefined): string | undefined {
  if (!conversation) return undefined
  return conversation.name?.trim() || conversation.preview.trim() || undefined
}
