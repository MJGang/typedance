import "@testing-library/jest-dom/vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { WorkspaceView } from "@typedance/contracts"
import { ExportGateModal } from "./ExportGateModal"

const apiMocks = vi.hoisted(() => ({
  exportRevisionDraftPdf: vi.fn(),
}))

vi.mock("@/api", () => ({
  exportRevisionDraftPdf: (...args: unknown[]) => apiMocks.exportRevisionDraftPdf(...args),
}))

const workspace: WorkspaceView = {
  document: {
    id: "doc_1",
    pack_id: "resume",
    title: "张三的简历",
    status: "active",
    target_language: "zh-CN",
    current_draft_id: "draft_1",
    created_at: "2026-05-21T08:00:00.000Z",
    updated_at: "2026-05-21T08:00:00.000Z",
  },
  current_draft: {
    id: "draft_1",
    document_id: "doc_1",
    run_id: "run_1",
    pack_id: "resume",
    status: "in_review",
    summary: "结构化草稿",
    applied_proposal_ids: [],
    unresolved_issue_ids: ["issue_1"],
    variant_type: "base",
    created_at: "2026-05-21T08:00:00.000Z",
    updated_at: "2026-05-21T08:00:00.000Z",
  },
  modules: [],
  claims: [],
  issues: [
    {
      id: "issue_1",
      run_id: "run_1",
      document_id: "doc_1",
      draft_id: "draft_1",
      type: "missing_result",
      severity: "warning",
      title: "缺少结果",
      message: "建议导出前补充结果。",
      reason: "结果不清晰。",
      status: "open",
      created_by_agent: "ResumeReviewer",
      evidence_link_ids: [],
      actions: [],
      created_at: "2026-05-21T08:00:00.000Z",
    },
  ],
  proposals: [],
  evidence: [],
  source_summaries: [],
  quality_gate: {
    status: "needs_review",
    blocking_issue_ids: [],
    warning_issue_ids: ["issue_1"],
  },
  available_actions: [],
}

describe("ExportGateModal", () => {
  beforeEach(() => {
    apiMocks.exportRevisionDraftPdf.mockReset()
    apiMocks.exportRevisionDraftPdf.mockResolvedValue({
      fileName: "resume.pdf",
      filePath: "D:/exports/resume.pdf",
      artifactId: "export_1",
      reviewStatus: "forced_with_risk",
    })
  })

  it("exports with explicit risk when only warnings remain", async () => {
    const onCompleted = vi.fn()

    render(
      <ExportGateModal
        workspace={workspace}
        open
        onOpenChange={vi.fn()}
        onCompleted={onCompleted}
      />,
    )

    expect(screen.getByRole("heading", { name: "导出门禁" })).toBeInTheDocument()
    expect(screen.getByText("缺少结果")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "带风险导出" }))

    await waitFor(() => expect(apiMocks.exportRevisionDraftPdf).toHaveBeenCalledWith(
      "draft_1",
      "张三的简历",
      { forceWithRisk: true },
    ))
    await waitFor(() => expect(onCompleted).toHaveBeenCalled())
    expect(await screen.findByText(/PDF 已导出/)).toBeInTheDocument()
  })

  it("blocks export when blocking issues are open", () => {
    const blockedWorkspace: WorkspaceView = {
      ...workspace,
      issues: [
        {
          ...workspace.issues[0],
          id: "issue_blocking",
          severity: "blocking",
          title: "缺少联系方式",
        },
      ],
      quality_gate: {
        status: "blocked",
        blocking_issue_ids: ["issue_blocking"],
        warning_issue_ids: [],
      },
    }

    render(
      <ExportGateModal
        workspace={blockedWorkspace}
        open
        onOpenChange={vi.fn()}
        onCompleted={vi.fn()}
      />,
    )

    expect(screen.getByText("暂不能导出")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "导出 PDF" })).toBeDisabled()
  })
})
