import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { AlertCircle, ArrowLeft, BriefcaseBusiness, Check, Download, FileText, Loader2, RefreshCcw, Send, ShieldCheck, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  acceptRevisionProposal,
  createRevisionRun,
  dismissRevisionIssue,
  getRevisionWorkspaceView,
  rejectRevisionProposal,
  renderRevisionDraft,
  runRevisionQualityReview,
} from "@/api"
import { ExportGateModal } from "./ExportGateModal"
import { OpportunityCalibrationModal } from "./OpportunityCalibrationModal"
import type {
  ContextualAction,
  DocumentClaim,
  DocumentModule,
  EvidenceLink,
  RevisionIssue,
  RevisionProposal,
  SourceDocumentSummary,
  WorkspaceView,
} from "@typedance/contracts"

type LoadState =
  | { status: "loading" }
  | { status: "loaded"; workspace: WorkspaceView }
  | { status: "error"; message: string }

type MobilePanel = "draft" | "review"

function qualityLabel(status?: string) {
  if (status === "blocked") return "阻塞"
  if (status === "needs_review") return "待处理"
  if (status === "ready") return "可导出"
  return "未知"
}

function qualityClass(status?: string) {
  if (status === "blocked") return "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
  if (status === "needs_review") return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"
  if (status === "ready") return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"
  return "border-border bg-muted text-muted-foreground"
}

function moduleLines(module: DocumentModule) {
  const items = module.data.items
  if (Array.isArray(items)) {
    return items.flatMap((item) => {
      if (typeof item === "string") return item ? [item] : []
      if (!item || typeof item !== "object") return []
      const record = item as Record<string, unknown>
      const title = [record.title, record.role, record.company, record.time_range]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .join(" / ")
      const description = typeof record.description === "string" ? record.description : ""
      const bullets = Array.isArray(record.bullets)
        ? record.bullets.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        : []
      return [title, description, ...bullets].filter(Boolean)
    })
  }

  return Object.entries(module.data)
    .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
    .map(([key, value]) => `${key}: ${value}`)
}

function ModuleList({ modules }: { modules: DocumentModule[] }) {
  if (modules.length === 0) {
    return <p className="text-sm text-muted-foreground">还没有可展示的结构化模块。</p>
  }

  return (
    <div className="space-y-5">
      {modules.map((module) => (
        <section key={module.id} className="border-b border-border pb-4 last:border-b-0">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">{module.title}</h2>
            <span className="shrink-0 text-xs text-muted-foreground">{module.status}</span>
          </div>
          <ul className="space-y-1.5 text-sm leading-6 text-foreground/85">
            {moduleLines(module).map((line, index) => (
              <li key={`${module.id}-${index}`} className="pl-3 [text-indent:-0.75rem]">
                <span className="text-muted-foreground">- </span>{line}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
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
  const [exportOpen, setExportOpen] = useState(false)
  const [selectedIssueId, setSelectedIssueId] = useState<string | undefined>()
  const [issueContextInput, setIssueContextInput] = useState("")
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("review")

  const loadWorkspace = useCallback(async () => {
    if (!documentId) return
    setState({ status: "loading" })
    try {
      const workspace = await getRevisionWorkspaceView(documentId)
      setState({ status: "loaded", workspace })
    } catch {
      setState({ status: "error", message: "无法加载工作台，请检查 Sidecar 服务。" })
    }
  }, [documentId])

  useEffect(() => {
    if (!documentId) return
    let ignore = false
    setState({ status: "loading" })
    getRevisionWorkspaceView(documentId)
      .then((workspace) => {
        if (!ignore) setState({ status: "loaded", workspace })
      })
      .catch(() => {
        if (!ignore) setState({ status: "error", message: "无法加载工作台，请检查 Sidecar 服务。" })
      })
    return () => {
      ignore = true
    }
  }, [documentId])

  const workspace = state.status === "loaded" ? state.workspace : null
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

  const handleRender = useCallback(async () => {
    if (!workspace?.current_draft) return
    setActingActionId("render")
    try {
      await renderRevisionDraft(workspace.current_draft.id, "default-a4")
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

  const handleSubmitIssueContext = useCallback(async () => {
    const userIntent = issueContextInput.trim()
    if (!workspace?.current_draft || !selectedIssue || !userIntent) return

    const actionId = issueContextActionId(selectedIssue.id)
    setActingActionId(actionId)
    try {
      await createRevisionRun(workspace.document.id, {
        run_type: "issue_action",
        base_draft_id: workspace.current_draft.id,
        selected_module_id: selectedIssue.module_id,
        selected_issue_id: selectedIssue.id,
        user_intent: userIntent,
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

  return (
    <div className="flex min-h-[calc(100svh-3rem)] flex-col bg-background">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">{workspace.document.title}</h1>
          <p className="truncate text-xs text-muted-foreground">{workspace.run_status?.status ?? "未运行"}</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
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
          <Button
            size="sm"
            onClick={() => setExportOpen(true)}
            disabled={!workspace.current_draft}
          >
            <Download className="mr-2 h-4 w-4" />
            导出
          </Button>
          <span className={`rounded-md border px-2 py-1 text-xs ${qualityClass(workspace.quality_gate?.status)}`}>
            {qualityLabel(workspace.quality_gate?.status)}
          </span>
        </div>
      </header>

      <div className="border-b border-border px-4 py-2 lg:hidden">
        <div className="grid grid-cols-2 gap-1 rounded-md border border-border bg-muted/35 p-1">
          <Button
            type="button"
            size="sm"
            variant={mobilePanel === "draft" ? "default" : "ghost"}
            aria-pressed={mobilePanel === "draft"}
            data-testid="revision-mobile-draft-tab"
            className="w-full"
            onClick={() => setMobilePanel("draft")}
          >
            草稿
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mobilePanel === "review" ? "default" : "ghost"}
            aria-pressed={mobilePanel === "review"}
            data-testid="revision-mobile-review-tab"
            className="w-full"
            onClick={() => setMobilePanel("review")}
          >
            问题处理
          </Button>
        </div>
      </div>

      <main className="grid min-h-0 flex-1 grid-cols-1 overflow-auto lg:grid-cols-[minmax(0,1fr)_360px]">
        <section
          data-testid="revision-draft-panel"
          className={cn(
            "min-w-0 border-b border-border p-4 lg:border-b-0 lg:border-r",
            mobilePanel !== "draft" && "hidden lg:block",
          )}
        >
          <div className="mx-auto max-w-3xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground">当前草稿</p>
                <h2 className="text-base font-semibold">{workspace.current_draft?.summary ?? "尚未生成草稿"}</h2>
              </div>
              <Button size="sm" variant="outline" onClick={handleRender} disabled={!workspace.current_draft || actingActionId === "render"}>
                <FileText className="mr-2 h-4 w-4" />
                {actingActionId === "render" ? "生成中" : "生成预览"}
              </Button>
            </div>
            {workspace.render_projection?.html ? (
              <div className="overflow-hidden rounded-md border border-border bg-white shadow-sm">
                <iframe
                  title="结构化草稿预览"
                  srcDoc={workspace.render_projection.html}
                  className="h-[720px] w-full bg-white"
                />
              </div>
            ) : (
              <div className="rounded-md border border-border p-4">
                <ModuleList modules={workspace.modules} />
              </div>
            )}
          </div>
        </section>

        <aside
          data-testid="revision-review-panel"
          className={cn(
            "min-w-0 space-y-5 p-4",
            mobilePanel !== "review" && "hidden lg:block",
          )}
        >
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
      <ExportGateModal
        workspace={workspace}
        open={exportOpen}
        onOpenChange={setExportOpen}
        onCompleted={loadWorkspace}
      />
    </div>
  )
}
