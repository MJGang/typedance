import { useEffect, useMemo, useState } from "react"
import { FileDown, Loader2, ShieldAlert, ShieldCheck } from "lucide-react"
import { exportRevisionDraftPdf } from "@/api"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { RevisionIssue, WorkspaceView } from "@typedance/contracts"

const OPEN_ISSUE_STATUSES = new Set(["open", "needs_user_input"])

type ExportGateModalProps = {
  workspace: WorkspaceView
  open: boolean
  onOpenChange: (open: boolean) => void
  onCompleted: () => Promise<void> | void
}

function openIssuesBySeverity(issues: RevisionIssue[], severity: "blocking" | "warning" | "info") {
  return issues.filter((issue) => issue.severity === severity && OPEN_ISSUE_STATUSES.has(issue.status))
}

export function ExportGateModal({ workspace, open, onOpenChange, onCompleted }: ExportGateModalProps) {
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setSubmitting(false)
    setResult(null)
    setError(null)
  }, [open])

  const blockingIssues = useMemo(() => openIssuesBySeverity(workspace.issues, "blocking"), [workspace.issues])
  const warningIssues = useMemo(
    () => [
      ...openIssuesBySeverity(workspace.issues, "warning"),
      ...openIssuesBySeverity(workspace.issues, "info"),
    ],
    [workspace.issues],
  )
  const gateStatus = workspace.quality_gate?.status ?? "unknown"
  const canExport = Boolean(workspace.current_draft) && blockingIssues.length === 0
  const forceWithRisk = warningIssues.length > 0 || gateStatus === "needs_review"

  async function handleExport() {
    if (!workspace.current_draft || !canExport) return
    setSubmitting(true)
    setError(null)
    setResult(null)
    try {
      const exported = await exportRevisionDraftPdf(workspace.current_draft.id, workspace.document.title, {
        forceWithRisk,
      })
      if (exported) {
        const path = exported.filePath ? `：${exported.filePath}` : ""
        setResult(`PDF 已导出${path}`)
      }
      await onCompleted()
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出失败，请稍后重试。")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>导出门禁</DialogTitle>
          <DialogDescription>导出前检查当前草稿、问题卡和渲染投影，避免把明显风险带进正式 PDF。</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border border-border p-3">
            <div className="flex items-center gap-2">
              {canExport ? (
                <ShieldCheck className="size-4 text-emerald-600" />
              ) : (
                <ShieldAlert className="size-4 text-red-600" />
              )}
              <p className="text-sm font-medium">
                {canExport ? "可以进入导出" : "暂不能导出"}
              </p>
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {canExport
                ? forceWithRisk
                  ? "当前还有建议处理的问题，继续导出会记录为带风险导出。"
                  : "当前没有打开的阻塞或提醒问题，可以生成正式 PDF。"
                : "当前还有阻塞问题，请先处理对应问题卡。"}
            </p>
          </div>

          {blockingIssues.length > 0 && (
            <IssueSummary title="阻塞问题" issues={blockingIssues} />
          )}
          {warningIssues.length > 0 && (
            <IssueSummary title="建议处理" issues={warningIssues} />
          )}

          {result && (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {result}
            </p>
          )}
          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            关闭
          </Button>
          <Button type="button" onClick={handleExport} disabled={!canExport || submitting}>
            {submitting ? <Loader2 className="mr-2 size-4 animate-spin" /> : <FileDown className="mr-2 size-4" />}
            {forceWithRisk ? "带风险导出" : "导出 PDF"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function IssueSummary({ title, issues }: { title: string; issues: RevisionIssue[] }) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-muted-foreground">{title}</p>
      <div className="space-y-2">
        {issues.map((issue) => (
          <div key={issue.id} className="rounded-md border border-border px-3 py-2">
            <p className="text-sm font-medium">{issue.title}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{issue.message}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
