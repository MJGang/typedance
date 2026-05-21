import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { AlertCircle, ArrowLeft, BriefcaseBusiness, Check, Download, FileText, Loader2, RefreshCcw, ShieldCheck, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  acceptRevisionProposal,
  dismissRevisionIssue,
  getRevisionWorkspaceView,
  rejectRevisionProposal,
  renderRevisionDraft,
  runRevisionQualityReview,
} from "@/api"
import { ExportGateModal } from "./ExportGateModal"
import { OpportunityCalibrationModal } from "./OpportunityCalibrationModal"
import type { ContextualAction, DocumentModule, RevisionIssue, RevisionProposal, WorkspaceView } from "@typedance/contracts"

type LoadState =
  | { status: "loading" }
  | { status: "loaded"; workspace: WorkspaceView }
  | { status: "error"; message: string }

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
  if (target.module_id && target.module_id === proposal.target.module_id) return true
  return action.id.endsWith(proposal.id)
}

function issueActions(issue: RevisionIssue, proposals: RevisionProposal[], actions: ContextualAction[]) {
  const relatedProposalIds = new Set(proposals.filter((proposal) => proposal.related_issue_ids.includes(issue.id)).map((proposal) => proposal.id))
  return actions.filter((action) => {
    if (action.target?.issue_id === issue.id) return true
    return proposals.some((proposal) => relatedProposalIds.has(proposal.id) && targetMatches(action, proposal))
  })
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
  actions,
  actingActionId,
  onAction,
}: {
  issue: RevisionIssue | null
  module?: DocumentModule
  proposals: RevisionProposal[]
  actions: ContextualAction[]
  actingActionId: string | null
  onAction: (action: ContextualAction) => void
}) {
  if (!issue) {
    return (
      <section aria-label="问题处理详情" className="rounded-md border border-dashed border-border p-3" role="region">
        <p className="text-sm text-muted-foreground">选择一个问题后，这里会显示局部改稿说明、相关建议和可执行动作。</p>
      </section>
    )
  }

  const relatedProposals = proposals.filter((proposal) => proposal.related_issue_ids.includes(issue.id))
  const availableActions = issueActions(issue, proposals, actions)

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
    () => visibleIssues.find((issue) => issue.id === selectedIssueId) ?? null,
    [selectedIssueId, visibleIssues],
  )
  const selectedIssueModule = useMemo(
    () => workspace?.modules.find((module) => module.id === selectedIssue?.module_id),
    [selectedIssue, workspace],
  )

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

  return (
    <div className="flex min-h-[calc(100svh-3rem)] flex-col bg-background">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">{workspace.document.title}</h1>
          <p className="truncate text-xs text-muted-foreground">{workspace.run_status?.status ?? "未运行"}</p>
        </div>
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
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 overflow-auto lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-w-0 border-b border-border p-4 lg:border-b-0 lg:border-r">
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

        <aside className="min-w-0 space-y-5 p-4">
          <section>
            <p className="mb-2 text-xs font-medium text-muted-foreground">引导</p>
            <div className="rounded-md border border-border p-3">
              <p className="text-sm leading-6">{workspace.coach_summary?.summary ?? "暂无引导信息。"}</p>
            </div>
          </section>

          <section>
            <p className="mb-2 text-xs font-medium text-muted-foreground">下一步</p>
            <div className="flex flex-wrap gap-2">
              {workspace.available_actions.length === 0 ? (
                <span className="text-sm text-muted-foreground">暂无可执行动作。</span>
              ) : workspace.available_actions.map((action) => (
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

          <section>
            <p className="mb-2 text-xs font-medium text-muted-foreground">问题</p>
            <IssueList issues={visibleIssues} selectedIssueId={selectedIssue?.id} onSelectIssue={setSelectedIssueId} />
          </section>

          <IssueDetail
            issue={selectedIssue}
            module={selectedIssueModule}
            proposals={workspace.proposals}
            actions={workspace.available_actions}
            actingActionId={actingActionId}
            onAction={handleAction}
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
