import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useOutletContext, useParams } from "react-router-dom"
import { AlertCircle, ArrowLeft, BriefcaseBusiness, Check, ChevronDown, Download, FileText, Loader2, Pencil, RefreshCcw, Send, ShieldCheck, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  acceptRevisionProposal,
  dismissRevisionIssue,
  exportRevisionDocumentHtml,
  exportRevisionDocumentPdf,
  getRevisionWorkspaceView,
  rejectRevisionProposal,
  runRevisionIssueAction,
  runRevisionQualityReview,
  updateRevisionDocument,
} from "@/api"
import { resumePackPaths } from "../resume-pack/routes"
import { DraftCanvas } from "./DraftCanvas"
import { OpportunityCalibrationModal } from "./OpportunityCalibrationModal"
import { DEFAULT_SOURCE_CANVAS_PAGE_MARGINS, type PageMargins } from "./pageMargins"
import { defaultClassicA4Style } from "../templates/data"
import { useSourceCanvasAutosave } from "./useSourceCanvasAutosave"
import type { RevisionWorkspaceChromeContext } from "@/components/SiteLayout"
import type {
  ContextualAction,
  DocumentClaim,
  DocumentModule,
  EvidenceLink,
  RevisionIssue,
  RevisionProposal,
  SourceResumeCanvas,
  SourceDocumentSummary,
  WorkspaceView,
} from "@typedance/contracts"

type LoadState =
  | { status: "loading" }
  | { status: "loaded"; workspace: WorkspaceView }
  | { status: "error"; message: string }

type RevisionExportFormat = "pdf" | "html"

const SOURCE_CANVAS_TEXT_CURSOR_CLASS = "td-source-canvas-cursor-text"

function qualityLabel(status?: string) {
  if (status === "blocked") return "需处理"
  if (status === "needs_review") return "待处理"
  if (status === "ready") return "已检查"
  return "未知"
}

function qualityClass(status?: string) {
  if (status === "blocked") return "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
  if (status === "needs_review") return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"
  if (status === "ready") return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"
  return "border-border bg-muted text-muted-foreground"
}

function targetMatches(action: ContextualAction, proposal: RevisionProposal) {
  const target = action.target
  if (!target) return false
  if (target.proposal_id && target.proposal_id === proposal.id) return true
  if (target.claim_id && target.claim_id === proposal.target.claim_id) return true
  return action.id.endsWith(proposal.id)
}

function issueActions(issue: RevisionIssue, proposals: RevisionProposal[], actions: ContextualAction[]) {
  const relatedProposalIds = new Set(proposals.filter((proposal) => proposal.related_issue_ids.includes(issue.id)).map((proposal) => proposal.id))
  return actions.filter((action) => {
    if (action.target?.issue_id === issue.id) return true
    if (action.action_type === "dismiss_issue") {
      return action.id.endsWith(issue.id) || (!!issue.claim_id && action.target?.claim_id === issue.claim_id)
    }
    return proposals.some((proposal) => relatedProposalIds.has(proposal.id) && targetMatches(action, proposal))
  })
}

function documentLevelActions(actions: ContextualAction[]) {
  return actions.filter((action) => !action.target || Object.keys(action.target).length === 0)
}

function issueClaims(issue: RevisionIssue, proposals: RevisionProposal[], claims: DocumentClaim[]) {
  const claimIds = new Set<string>()
  if (issue.claim_id) claimIds.add(issue.claim_id)
  for (const proposal of proposals) {
    if (proposal.target.claim_id) claimIds.add(proposal.target.claim_id)
  }
  return claims.filter((claim) => claimIds.has(claim.id))
}

function issueEvidence(
  issue: RevisionIssue,
  proposals: RevisionProposal[],
  claims: DocumentClaim[],
  evidence: EvidenceLink[],
) {
  const evidenceIds = new Set<string>(issue.evidence_link_ids)
  const claimIds = new Set(claims.map((claim) => claim.id))
  for (const proposal of proposals) {
    proposal.evidence_link_ids.forEach((evidenceId) => evidenceIds.add(evidenceId))
    if (proposal.target.claim_id) claimIds.add(proposal.target.claim_id)
  }

  const seen = new Set<string>()
  return evidence.filter((item) => {
    const matches = evidenceIds.has(item.id) || (!!item.claim_id && claimIds.has(item.claim_id))
    if (!matches || seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

function sourceTitle(sourceSummaries: SourceDocumentSummary[], sourceDocumentId: string) {
  return sourceSummaries.find((source) => source.id === sourceDocumentId)?.title ?? "未知来源"
}

function issueContextActionId(issueId: string) {
  return `issue_context_${issueId}`
}

function mergeLatestSavedCanvas(workspace: WorkspaceView, latestSavedCanvas: SourceResumeCanvas | null) {
  if (!latestSavedCanvas || latestSavedCanvas.document_id !== workspace.document.id) return workspace
  return {
    ...workspace,
    source_resume_canvas: latestSavedCanvas,
  }
}

function IssueList({
  issues,
  selectedIssueId,
  onSelectIssue,
}: {
  issues: RevisionIssue[]
  selectedIssueId?: string
  onSelectIssue: (issueId: string) => void
}) {
  if (issues.length === 0) {
    return <p className="text-sm text-muted-foreground">暂时没有需要处理的问题。</p>
  }

  return (
    <div className="space-y-2">
      {issues.map((issue) => (
        <button
          key={issue.id}
          type="button"
          aria-pressed={selectedIssueId === issue.id}
          data-testid={`revision-issue-${issue.id}`}
          className={cn(
            "w-full rounded-md border border-border p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/40",
            selectedIssueId === issue.id && "border-primary bg-primary/5",
          )}
          onClick={() => onSelectIssue(issue.id)}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{issue.title}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{issue.message}</p>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">{issue.severity}</span>
          </div>
        </button>
      ))}
    </div>
  )
}

function ProposalList({ proposals }: { proposals: RevisionProposal[] }) {
  const pending = proposals.filter((proposal) => proposal.status === "pending")
  if (pending.length === 0) {
    return <p className="text-sm text-muted-foreground">暂无待确认的修改建议。</p>
  }

  return (
    <div className="space-y-2">
      {pending.map((proposal) => (
        <div key={proposal.id} className="rounded-md border border-border p-3">
          <p className="text-sm font-medium">{proposal.summary}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{proposal.rationale}</p>
        </div>
      ))}
    </div>
  )
}

function IssueDetail({
  issue,
  module,
  proposals,
  claims,
  evidence,
  sourceSummaries,
  actions,
  actingActionId,
  contextInput,
  isSubmittingContextInput,
  onAction,
  onContextInputChange,
  onSubmitContextInput,
}: {
  issue: RevisionIssue | null
  module?: DocumentModule
  proposals: RevisionProposal[]
  claims: DocumentClaim[]
  evidence: EvidenceLink[]
  sourceSummaries: SourceDocumentSummary[]
  actions: ContextualAction[]
  actingActionId: string | null
  contextInput: string
  isSubmittingContextInput: boolean
  onAction: (action: ContextualAction) => void
  onContextInputChange: (value: string) => void
  onSubmitContextInput: () => void
}) {
  if (!issue) {
    return (
      <section aria-label="问题处理详情" className="rounded-md border border-dashed border-border p-3" role="region">
        <p className="text-sm text-muted-foreground">选择一个问题后，这里会显示局部改稿说明、相关建议和可执行动作。</p>
      </section>
    )
  }

  const relatedProposals = proposals.filter((proposal) => proposal.related_issue_ids.includes(issue.id))
  const relatedClaims = issueClaims(issue, relatedProposals, claims)
  const relatedEvidence = issueEvidence(issue, relatedProposals, relatedClaims, evidence)
  const availableActions = issueActions(issue, proposals, actions)
  const contextInputId = `issue-context-input-${issue.id}`

  return (
    <section aria-label="问题处理详情" className="rounded-md border border-border p-3" role="region">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground">当前问题</p>
          <h3 className="mt-1 text-sm font-semibold">{issue.title}</h3>
        </div>
        <span className={`rounded-md border px-2 py-1 text-xs ${qualityClass(issue.severity === "blocking" ? "blocked" : "needs_review")}`}>
          {issue.severity}
        </span>
      </div>

      <div className="mt-3 space-y-2 text-sm leading-6">
        <p>{issue.message}</p>
        <p className="text-muted-foreground">影响模块：{module?.title ?? "未定位模块"}</p>
        <p className="text-muted-foreground">{issue.reason}</p>
      </div>

      {relatedClaims.length > 0 || relatedEvidence.length > 0 ? (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">当前依据</p>
          {relatedClaims.map((claim) => (
            <p key={claim.id} className="rounded-md bg-muted/35 p-3 text-sm leading-6">
              原始主张：{claim.text}
            </p>
          ))}
          {relatedEvidence.map((item) => (
            <div key={item.id} className="rounded-md border border-border p-3 text-sm leading-6">
              <p>来源：{sourceTitle(sourceSummaries, item.source_document_id)}</p>
              {item.extracted_text ? <p className="text-muted-foreground">原文：{item.extracted_text}</p> : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-4 space-y-2">
        <p className="text-xs font-medium text-muted-foreground">相关修改建议</p>
        {relatedProposals.length === 0 ? (
          <p className="text-sm text-muted-foreground">当前问题还没有可直接接受的建议。</p>
        ) : relatedProposals.map((proposal) => (
          <div key={proposal.id} className="rounded-md bg-muted/45 p-3">
            <p className="text-sm font-medium">{proposal.summary}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{proposal.rationale}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {availableActions.length === 0 ? (
          <span className="text-sm text-muted-foreground">暂无可执行动作。</span>
        ) : availableActions.map((action) => (
          <Button
            key={action.id}
            size="sm"
            variant={action.action_type === "accept_proposal" ? "default" : "outline"}
            onClick={() => onAction(action)}
            disabled={actingActionId === action.id}
          >
            {action.action_type === "accept_proposal" ? <Check className="mr-2 h-4 w-4" /> : null}
            {action.action_type === "reject_proposal" ? <X className="mr-2 h-4 w-4" /> : null}
            {action.label}
          </Button>
        ))}
      </div>

      <form
        className="mt-4 space-y-2 rounded-md border border-dashed border-border p-3"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmitContextInput()
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor={contextInputId}>补充事实</Label>
          <Textarea
            id={contextInputId}
            value={contextInput}
            onChange={(event) => onContextInputChange(event.target.value)}
            placeholder="例如：这个项目让接口错误率下降 30%，日均处理 2 万订单。"
            rows={3}
            className="min-h-24 resize-y"
          />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-5 text-muted-foreground">这段内容会绑定到当前问题，作为下一轮局部改稿的上下文。</p>
          <Button type="submit" size="sm" disabled={!contextInput.trim() || isSubmittingContextInput}>
            {isSubmittingContextInput ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            提交补充
          </Button>
        </div>
      </form>
    </section>
  )
}

export function RevisionWorkspacePage() {
  const { documentId } = useParams<{ documentId: string }>()
  const navigate = useNavigate()
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [actingActionId, setActingActionId] = useState<string | null>(null)
  const [opportunityOpen, setOpportunityOpen] = useState(false)
  const [exportingFormat, setExportingFormat] = useState<RevisionExportFormat | null>(null)
  const [sourceCanvasPageMargins, setSourceCanvasPageMargins] = useState<PageMargins | null>(null)
  const [selectedIssueId, setSelectedIssueId] = useState<string | undefined>()
  const [issueContextInput, setIssueContextInput] = useState("")
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState("")
  const [titleSaveError, setTitleSaveError] = useState<string | null>(null)
  const [isSavingTitle, setIsSavingTitle] = useState(false)
  const chromeContext = useOutletContext<Partial<RevisionWorkspaceChromeContext> | undefined>()
  const reviewPanelVisible = chromeContext?.reviewPanelVisible ?? true
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
  const visibleIssues = useMemo(
    () => workspace?.issues.filter((issue) => issue.status === "open" || issue.status === "needs_user_input") ?? [],
    [workspace],
  )
  const selectedIssue = useMemo(
    () => visibleIssues.find((issue) => issue.id === selectedIssueId) ?? visibleIssues[0] ?? null,
    [selectedIssueId, visibleIssues],
  )
  const selectedIssueModule = useMemo(
    () => workspace?.modules.find((module) => module.id === selectedIssue?.module_id),
    [selectedIssue, workspace],
  )

  useEffect(() => {
    setIssueContextInput("")
  }, [selectedIssue?.id])

  const handleAction = useCallback(async (action: ContextualAction) => {
    if (!workspace) return
    setActingActionId(action.id)
    try {
      if (action.action_type === "accept_proposal" && action.id.startsWith("act_accept_")) {
        await acceptRevisionProposal(action.id.replace("act_accept_", ""))
      } else if (action.action_type === "reject_proposal" && action.id.startsWith("act_reject_")) {
        await rejectRevisionProposal(action.id.replace("act_reject_", ""))
      } else if (action.action_type === "dismiss_issue" && action.id.startsWith("act_dismiss_")) {
        await dismissRevisionIssue(action.id.replace("act_dismiss_", ""))
      } else if (action.action_type === "view_source") {
        return
      }
      await loadWorkspace()
    } finally {
      setActingActionId(null)
    }
  }, [loadWorkspace, workspace])

  const handleQualityReview = useCallback(async () => {
    if (!workspace?.current_draft) return
    setActingActionId("quality_review")
    try {
      await runRevisionQualityReview(workspace.document.id, workspace.current_draft.id)
      await loadWorkspace()
    } finally {
      setActingActionId(null)
    }
  }, [loadWorkspace, workspace])

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
      const formatLabel = format === "pdf" ? "PDF" : "HTML"
      toast.success(`${formatLabel} 导出成功`, {
        description: `已保存为 ${result.fileName}`,
        duration: 4000,
      })
    } catch {
      const formatLabel = format === "pdf" ? "PDF" : "HTML"
      toast.error(`${formatLabel} 导出失败`, {
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

  const handleSubmitIssueContext = useCallback(async () => {
    const userIntent = issueContextInput.trim()
    if (!workspace?.current_draft || !selectedIssue || !userIntent) return

    const actionId = issueContextActionId(selectedIssue.id)
    setActingActionId(actionId)
    try {
      await runRevisionIssueAction({
        documentId: workspace.document.id,
        baseDraftId: workspace.current_draft.id,
        selectedModuleId: selectedIssue.module_id,
        selectedIssueId: selectedIssue.id,
        userIntent,
      })
      setIssueContextInput("")
      await loadWorkspace()
    } finally {
      setActingActionId(null)
    }
  }, [issueContextInput, loadWorkspace, selectedIssue, workspace])

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
  const globalActions = documentLevelActions(workspace.available_actions)
  const exportDisabled = !sourceCanvas || exportingFormat !== null

  return (
    <div className="flex h-[calc(100svh-3rem)] min-h-0 flex-col overflow-hidden bg-background">
      <main
        data-testid="revision-workspace-grid"
        className={cn(
          "grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_360px] overflow-hidden",
          !reviewPanelVisible && "grid-cols-[minmax(0,1fr)]",
        )}
      >
        <section
          data-testid="revision-draft-column"
          className={cn(
            "flex min-h-0 min-w-0 flex-col overflow-hidden",
            reviewPanelVisible && "border-r border-border",
          )}
        >
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
                  onChange={handleCanvasChange}
                  onPageMarginsChange={setSourceCanvasPageMargins}
                  onRetrySave={retryCanvasSave}
                  saveStatus={canvasSaveStatus}
                  templateStyle={defaultClassicA4Style}
                />
              ) : (
                <div className="rounded-md border border-border bg-muted/30 p-4">
                  <p className="text-sm font-medium">原始画布尚未生成</p>
                </div>
              )}
            </div>
          </div>
        </section>

        <aside
          data-testid="revision-review-panel"
          className={cn(
            "min-h-0 min-w-0 space-y-5 overflow-y-auto p-4",
            !reviewPanelVisible && "hidden",
          )}
        >
          <section data-testid="revision-review-actions" className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleQualityReview}
              disabled={!workspace.current_draft || actingActionId === "quality_review"}
            >
              {actingActionId === "quality_review" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheck className="mr-2 h-4 w-4" />
              )}
              质量检查
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setOpportunityOpen(true)}
              disabled={!workspace.current_draft}
            >
              <BriefcaseBusiness className="mr-2 h-4 w-4" />
              岗位校准
            </Button>
            <span className={`rounded-md border px-2 py-1 text-xs ${qualityClass(workspace.quality_gate?.status)}`}>
              {qualityLabel(workspace.quality_gate?.status)}
            </span>
          </section>

          <section>
            <p className="mb-2 text-xs font-medium text-muted-foreground">引导</p>
            <div className="rounded-md border border-border p-3">
              <p className="text-sm leading-6">{workspace.coach_summary?.summary ?? "暂无引导信息。"}</p>
            </div>
          </section>

          {globalActions.length > 0 ? (
            <section>
              <p className="mb-2 text-xs font-medium text-muted-foreground">下一步</p>
              <div className="flex flex-wrap gap-2">
                {globalActions.map((action) => (
                  <Button
                    key={action.id}
                    size="sm"
                    variant={action.action_type === "accept_proposal" ? "default" : "outline"}
                    onClick={() => handleAction(action)}
                    disabled={actingActionId === action.id}
                  >
                    {action.action_type === "accept_proposal" ? <Check className="mr-2 h-4 w-4" /> : null}
                    {action.action_type === "reject_proposal" ? <X className="mr-2 h-4 w-4" /> : null}
                    {action.label}
                  </Button>
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <p className="mb-2 text-xs font-medium text-muted-foreground">问题</p>
            <IssueList issues={visibleIssues} selectedIssueId={selectedIssue?.id} onSelectIssue={setSelectedIssueId} />
          </section>

          <IssueDetail
            issue={selectedIssue}
            module={selectedIssueModule}
            proposals={workspace.proposals}
            claims={workspace.claims}
            evidence={workspace.evidence}
            sourceSummaries={workspace.source_summaries}
            actions={workspace.available_actions}
            actingActionId={actingActionId}
            contextInput={issueContextInput}
            isSubmittingContextInput={!!selectedIssue && actingActionId === issueContextActionId(selectedIssue.id)}
            onAction={handleAction}
            onContextInputChange={setIssueContextInput}
            onSubmitContextInput={handleSubmitIssueContext}
          />

          <section>
            <p className="mb-2 text-xs font-medium text-muted-foreground">修改建议</p>
            <ProposalList proposals={workspace.proposals} />
          </section>
        </aside>
      </main>
      {workspace.current_draft && (
        <OpportunityCalibrationModal
          documentId={workspace.document.id}
          baseDraftId={workspace.current_draft.id}
          open={opportunityOpen}
          onOpenChange={setOpportunityOpen}
          onCompleted={loadWorkspace}
        />
      )}
    </div>
  )
}
