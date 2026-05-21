import "@testing-library/jest-dom/vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { WorkspaceView } from "@typedance/contracts"
import { RevisionWorkspacePage } from "./RevisionWorkspacePage"

const apiMocks = vi.hoisted(() => ({
  getRevisionWorkspaceView: vi.fn(),
  renderRevisionDraft: vi.fn(),
  acceptRevisionProposal: vi.fn(),
  rejectRevisionProposal: vi.fn(),
  dismissRevisionIssue: vi.fn(),
  runRevisionQualityReview: vi.fn(),
  calibrateRevisionOpportunity: vi.fn(),
  exportRevisionDraftPdf: vi.fn(),
}))

vi.mock("@/api", () => ({
  getRevisionWorkspaceView: (...args: unknown[]) => apiMocks.getRevisionWorkspaceView(...args),
  renderRevisionDraft: (...args: unknown[]) => apiMocks.renderRevisionDraft(...args),
  acceptRevisionProposal: (...args: unknown[]) => apiMocks.acceptRevisionProposal(...args),
  rejectRevisionProposal: (...args: unknown[]) => apiMocks.rejectRevisionProposal(...args),
  dismissRevisionIssue: (...args: unknown[]) => apiMocks.dismissRevisionIssue(...args),
  runRevisionQualityReview: (...args: unknown[]) => apiMocks.runRevisionQualityReview(...args),
  calibrateRevisionOpportunity: (...args: unknown[]) => apiMocks.calibrateRevisionOpportunity(...args),
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
  modules: [
    {
      id: "mod_1",
      draft_id: "draft_1",
      pack_id: "resume",
      type: "ProjectExperience",
      title: "项目经历",
      order: 0,
      visibility: "visible",
      status: "needs_review",
      data: {
        items: [
          {
            title: "订单系统重构",
            role: "核心开发",
            description: "负责核心链路重构。",
          },
        ],
      },
      created_at: "2026-05-21T08:00:00.000Z",
      updated_at: "2026-05-21T08:00:00.000Z",
    },
  ],
  claims: [],
  issues: [
    {
      id: "issue_1",
      run_id: "run_1",
      document_id: "doc_1",
      draft_id: "draft_1",
      module_id: "mod_1",
      type: "missing_result",
      severity: "warning",
      title: "缺少结果",
      message: "这条经历看不出业务结果。",
      reason: "需要补充影响范围。",
      actions: [],
      status: "open",
      created_by_agent: "ResumeReviewer",
      evidence_link_ids: [],
      created_at: "2026-05-21T08:00:00.000Z",
    },
  ],
  proposals: [
    {
      id: "prop_1",
      run_id: "run_1",
      document_id: "doc_1",
      draft_id: "draft_1",
      target: { claim_id: "claim_1" },
      operation: "replace_claim",
      proposed_snapshot: { text: "主导订单系统重构，提升核心链路稳定性。" },
      summary: "改成结果导向表达",
      rationale: "原文只有动作。",
      related_issue_ids: ["issue_1"],
      evidence_link_ids: [],
      confidence: 0.8,
      risk_level: "medium",
      requires_user_confirmation: true,
      status: "pending",
      created_by_agent: "ResumeRewriter",
      created_at: "2026-05-21T08:00:00.000Z",
    },
  ],
  evidence: [],
  source_summaries: [],
  quality_gate: {
    status: "needs_review",
    blocking_issue_ids: [],
    warning_issue_ids: ["issue_1"],
  },
  run_status: {
    run_id: "run_1",
    status: "completed",
  },
  coach_summary: {
    summary: "还有 1 个问题建议处理后再导出。",
    next_action_ids: ["act_accept_prop_1"],
  },
  available_actions: [
    {
      id: "act_accept_prop_1",
      label: "接受修改",
      action_type: "accept_proposal",
      target: { claim_id: "claim_1" },
    },
  ],
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/revision/doc_1"]}>
      <Routes>
        <Route path="/revision/:documentId" element={<RevisionWorkspacePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe("RevisionWorkspacePage", () => {
  beforeEach(() => {
    apiMocks.getRevisionWorkspaceView.mockReset()
    apiMocks.renderRevisionDraft.mockReset()
    apiMocks.acceptRevisionProposal.mockReset()
    apiMocks.rejectRevisionProposal.mockReset()
    apiMocks.dismissRevisionIssue.mockReset()
    apiMocks.runRevisionQualityReview.mockReset()
    apiMocks.calibrateRevisionOpportunity.mockReset()
    apiMocks.exportRevisionDraftPdf.mockReset()
    apiMocks.getRevisionWorkspaceView.mockResolvedValue(workspace)
    apiMocks.acceptRevisionProposal.mockResolvedValue({ id: "prop_1", status: "applied" })
    apiMocks.runRevisionQualityReview.mockResolvedValue({ id: "run_review", status: "completed" })
    apiMocks.calibrateRevisionOpportunity.mockResolvedValue({ document: { id: "doc_1" } })
    apiMocks.exportRevisionDraftPdf.mockResolvedValue({ fileName: "resume.pdf", reviewStatus: "forced_with_risk" })
  })

  it("loads and renders the workspace view", async () => {
    renderPage()

    expect(screen.getByText("加载工作台")).toBeInTheDocument()
    expect(await screen.findByRole("heading", { name: "张三的简历" })).toBeInTheDocument()
    expect(screen.getByText("还有 1 个问题建议处理后再导出。")).toBeInTheDocument()
    expect(screen.getByText("订单系统重构 / 核心开发")).toBeInTheDocument()
    expect(screen.getByText("缺少结果")).toBeInTheDocument()
    expect(screen.getByText("改成结果导向表达")).toBeInTheDocument()
  })

  it("runs an available proposal action and refreshes the workspace", async () => {
    renderPage()

    fireEvent.click(await screen.findByRole("button", { name: /接受修改/ }))

    await waitFor(() => expect(apiMocks.acceptRevisionProposal).toHaveBeenCalledWith("prop_1"))
    await waitFor(() => expect(apiMocks.getRevisionWorkspaceView).toHaveBeenCalledTimes(2))
  })

  it("runs quality review and refreshes the workspace", async () => {
    renderPage()

    fireEvent.click(await screen.findByRole("button", { name: "质量检查" }))

    await waitFor(() => expect(apiMocks.runRevisionQualityReview).toHaveBeenCalledWith("doc_1", "draft_1"))
    await waitFor(() => expect(apiMocks.getRevisionWorkspaceView).toHaveBeenCalledTimes(2))
  })

  it("opens opportunity calibration from the workspace", async () => {
    renderPage()

    fireEvent.click(await screen.findByRole("button", { name: "岗位校准" }))

    expect(await screen.findByRole("heading", { name: "岗位校准" })).toBeInTheDocument()
    expect(screen.getByLabelText("岗位信息")).toBeInTheDocument()
  })

  it("opens export gate from the workspace", async () => {
    renderPage()

    fireEvent.click(await screen.findByRole("button", { name: "导出" }))

    expect(await screen.findByRole("heading", { name: "导出门禁" })).toBeInTheDocument()
    expect(screen.getAllByText("缺少结果").length).toBeGreaterThan(0)
  })
})
