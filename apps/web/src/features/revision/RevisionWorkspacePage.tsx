import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate, useOutletContext, useParams } from "react-router-dom"
import { AlertCircle, ArrowLeft, ChevronDown, Download, FileText, Loader2, Pencil, RefreshCcw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  exportRevisionDocumentHtml,
  exportRevisionDocumentPdf,
  getRevisionWorkspaceView,
  updateRevisionDocument,
} from "@/api"
import { resumePackPaths } from "../resume-pack/routes"
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
  const navigate = useNavigate()
  const chromeContext = useOutletContext<Partial<RevisionWorkspaceChromeContext> | undefined>()
  const assistantPanelVisible = chromeContext?.assistantPanelVisible ?? true
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [exportingFormat, setExportingFormat] = useState<RevisionExportFormat | null>(null)
  const [sourceCanvasPageMargins, setSourceCanvasPageMargins] = useState<PageMargins | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState("")
  const [titleSaveError, setTitleSaveError] = useState<string | null>(null)
  const [isSavingTitle, setIsSavingTitle] = useState(false)
  const [activeConversationId, setActiveConversationId] = useState<string | undefined>()
  const [conversations, setConversations] = useState<AgentConversation[]>([])
  const [conversationRefreshToken, setConversationRefreshToken] = useState(0)
  const [contextSources, setContextSources] = useState<ContextSource[]>([])
  const [canvasPatchFlash, setCanvasPatchFlash] = useState<CanvasPatchFlash | null>(null)
  const canvasPatchFlashSequenceRef = useRef(0)
  const mountedRef = useRef(false)
  const currentDocumentIdRef = useRef(documentId)
  const latestSavedCanvasRef = useRef<SourceResumeCanvas | null>(null)
  const loadRequestEpochRef = useRef(0)
  const draftPanelRef = useRef<HTMLDivElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const cancelTitleEditRef = useRef(false)
  const titleSaveInFlightRef = useRef(false)
  currentDocumentIdRef.current = documentId

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      loadRequestEpochRef.current += 1
    }
  }, [])

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

  const startTitleEditing = useCallback(() => {
    if (!workspace || isSavingTitle) return
    cancelTitleEditRef.current = false
    setTitleDraft(workspace.document.title)
    setTitleSaveError(null)
    setEditingTitle(true)
  }, [isSavingTitle, workspace])

  const cancelTitleEditing = useCallback(() => {
    cancelTitleEditRef.current = true
    setTitleDraft(workspace?.document.title ?? "")
    setTitleSaveError(null)
    setEditingTitle(false)
  }, [workspace])

  const commitTitleEditing = useCallback(async () => {
    if (!workspace) return
    if (cancelTitleEditRef.current) {
      cancelTitleEditRef.current = false
      return
    }
    if (titleSaveInFlightRef.current) return

    const trimmed = titleDraft.trim()
    if (!trimmed || trimmed === workspace.document.title) {
      setTitleDraft(workspace.document.title)
      setTitleSaveError(null)
      setEditingTitle(false)
      return
    }

    titleSaveInFlightRef.current = true
    setIsSavingTitle(true)
    setTitleSaveError(null)

    try {
      const updatedDocument = await updateRevisionDocument(workspace.document.id, { title: trimmed })
      if (!mountedRef.current || currentDocumentIdRef.current !== updatedDocument.id) return
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
      setEditingTitle(false)
    } catch {
      setTitleSaveError("标题保存失败，请稍后重试。")
      setEditingTitle(true)
      requestAnimationFrame(() => {
        titleInputRef.current?.focus()
        titleInputRef.current?.select()
      })
    } finally {
      titleSaveInFlightRef.current = false
      setIsSavingTitle(false)
    }
  }, [titleDraft, workspace])

  useEffect(() => {
    if (!editingTitle) return
    titleInputRef.current?.focus()
    titleInputRef.current?.select()
  }, [editingTitle])

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
  const activeConversationTitle = conversations.find((conversation) => conversation.id === activeConversationId)?.title

  return (
    <div className="flex h-[calc(100svh-3rem)] min-h-0 overflow-hidden bg-background">
      <WorkbenchSidebar
        workspaceId={workspace.document.id}
        title={workspace.document.title}
        activeConversationId={activeConversationId}
        conversationRefreshToken={conversationRefreshToken}
        onSelectConversation={setActiveConversationId}
        onContextSourcesChange={setContextSources}
        onConversationsChange={setConversations}
      />
      <main
        data-testid="revision-workspace-grid"
        className={cn(
          "grid min-h-0 min-w-0 flex-1 overflow-hidden",
          assistantPanelVisible
            ? "grid-cols-[minmax(48rem,1fr)_24rem]"
            : "grid-cols-[minmax(0,1fr)]",
        )}
      >
        <section data-testid="revision-draft-column" className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <header data-testid="revision-workspace-header" className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
            <Button variant="ghost" size="icon" aria-label="返回工作台" onClick={() => navigate(resumePackPaths.workspaces)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0 flex-1">
              {editingTitle ? (
                <div className="max-w-xl">
                  <Input
                    ref={titleInputRef}
                    aria-label="工作台标题"
                    className="h-8 rounded-md bg-background px-2 text-sm font-semibold"
                    value={titleDraft}
                    disabled={isSavingTitle}
                    onChange={(event) => setTitleDraft(event.target.value)}
                    onBlur={() => void commitTitleEditing()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault()
                        event.currentTarget.blur()
                      }
                      if (event.key === "Escape") {
                        event.preventDefault()
                        cancelTitleEditing()
                      }
                    }}
                  />
                  {titleSaveError ? <p className="mt-1 text-xs text-destructive">{titleSaveError}</p> : null}
                </div>
              ) : (
                <h1 className="min-w-0">
                  <button
                    type="button"
                    data-testid="revision-workspace-title-button"
                    title="编辑标题"
                    className="group flex max-w-full items-center gap-1.5 rounded-md px-1 py-1 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={startTitleEditing}
                  >
                    <span className="truncate text-sm font-semibold">{workspace.document.title}</span>
                    <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
                  </button>
                </h1>
              )}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" disabled={exportDisabled}>
                  {exportingFormat ? (
                    <Loader2 data-icon="inline-start" className="animate-spin" />
                  ) : (
                    <Download data-icon="inline-start" />
                  )}
                  {exportingFormat ? "导出中..." : "导出"}
                  <ChevronDown data-icon="inline-end" />
                </Button>
              </DropdownMenuTrigger>
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
          </header>
          <div
            ref={draftPanelRef}
            data-testid="revision-draft-panel"
            className="td-source-resume-canvas-viewport min-h-0 min-w-0 flex-1 overflow-hidden px-0 pt-0"
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
            activeConversationId={activeConversationId}
            activeConversationTitle={activeConversationTitle}
            contextSources={contextSources}
            onConversationCreated={handleConversationCreated}
            onConversationUpdated={refreshConversations}
            onCanvasPatchApplied={handleCanvasPatchApplied}
          />
        ) : null}
      </main>
    </div>
  )
}
