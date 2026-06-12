import "@testing-library/jest-dom/vitest"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter, Outlet, Route, Routes, useNavigate } from "react-router-dom"
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
  createRevisionRun: vi.fn(),
  calibrateRevisionOpportunity: vi.fn(),
  exportRevisionDocumentPdf: vi.fn(),
  exportRevisionDocumentHtml: vi.fn(),
  saveSourceResumeCanvas: vi.fn(),
  updateRevisionDocument: vi.fn(),
}))

const draftCanvasMocks = vi.hoisted(() => ({
  render: vi.fn(),
}))

vi.mock("@/api", () => ({
  getRevisionWorkspaceView: (...args: unknown[]) => apiMocks.getRevisionWorkspaceView(...args),
  renderRevisionDraft: (...args: unknown[]) => apiMocks.renderRevisionDraft(...args),
  acceptRevisionProposal: (...args: unknown[]) => apiMocks.acceptRevisionProposal(...args),
  rejectRevisionProposal: (...args: unknown[]) => apiMocks.rejectRevisionProposal(...args),
  dismissRevisionIssue: (...args: unknown[]) => apiMocks.dismissRevisionIssue(...args),
  runRevisionQualityReview: (...args: unknown[]) => apiMocks.runRevisionQualityReview(...args),
  createRevisionRun: (...args: unknown[]) => apiMocks.createRevisionRun(...args),
  calibrateRevisionOpportunity: (...args: unknown[]) => apiMocks.calibrateRevisionOpportunity(...args),
  exportRevisionDocumentPdf: (...args: unknown[]) => apiMocks.exportRevisionDocumentPdf(...args),
  exportRevisionDocumentHtml: (...args: unknown[]) => apiMocks.exportRevisionDocumentHtml(...args),
  saveSourceResumeCanvas: (...args: unknown[]) => apiMocks.saveSourceResumeCanvas(...args),
  updateRevisionDocument: (...args: unknown[]) => apiMocks.updateRevisionDocument(...args),
}))

function canvasText(docJson: unknown): string {
  if (!docJson || typeof docJson !== "object") return ""
  if ("text" in docJson && typeof docJson.text === "string") return docJson.text
  if (!("content" in docJson) || !Array.isArray(docJson.content)) return ""
  return docJson.content.map(canvasText).join("")
}

vi.mock("./DraftCanvas", () => ({
  DraftCanvas: ({
    canvas,
    onChange,
    onPageMarginsChange,
    onRetrySave,
    saveStatus,
  }: {
    canvas: WorkspaceView["source_resume_canvas"]
    onChange: (change: { plainText: string; docJson: { type: "doc"; content: unknown[] } }) => void
    onPageMarginsChange?: (margins: { top: number; bottom: number; left: number; right: number }) => void
    onRetrySave: () => void
    saveStatus: "idle" | "saving" | "saved" | "error"
  }) => (
    draftCanvasMocks.render(canvas?.document_id),
    <section aria-label="原始简历画布">
      <p>{canvasText(canvas?.doc_json)}</p>
      <button type="button" aria-expanded="true" aria-label="折叠模块大纲">模块大纲</button>
      {canvas?.module_anchors.map((anchor) => <button key={anchor.module_id} type="button">{anchor.title}</button>)}
      <button
        type="button"
        onClick={() => onChange({
          plainText: "负责核心链路重构并提升稳定性。",
          docJson: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                attrs: { canvasNodeId: "node_project", sourceBlockId: "block_project", moduleId: "mod_1" },
                content: [{ type: "text", text: "负责核心链路重构并提升稳定性。" }],
              },
            ],
          },
        })}
      >
        编辑原始画布
      </button>
      <button
        type="button"
        onClick={() => onChange({
          plainText: "负责核心链路重构并提升稳定性与可观测性。",
          docJson: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                attrs: { canvasNodeId: "node_project", sourceBlockId: "block_project", moduleId: "mod_1" },
                content: [{ type: "text", text: "负责核心链路重构并提升稳定性与可观测性。" }],
              },
            ],
          },
        })}
      >
        再次编辑原始画布
      </button>
      <button
        type="button"
        onClick={() => onPageMarginsChange?.({ top: 88, bottom: 72, left: 42, right: 48 })}
      >
        调整页边距
      </button>
      <span aria-live="polite">
        {saveStatus === "saving" ? "正在保存" : saveStatus === "saved" ? "已保存" : saveStatus === "error" ? "保存失败" : ""}
      </span>
      {saveStatus === "error" ? <button type="button" onClick={onRetrySave}>重试保存</button> : null}
    </section>
  ),
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
  claims: [
    {
      id: "claim_1",
      draft_id: "draft_1",
      module_id: "mod_1",
      item_id: "project_1",
      text: "负责核心链路重构。",
      claim_type: "responsibility",
      confidence: "supported",
      risk_flags: [],
      source_span_refs: [],
      created_at: "2026-05-21T08:00:00.000Z",
      updated_at: "2026-05-21T08:00:00.000Z",
    },
  ],
  issues: [
    {
      id: "issue_1",
      run_id: "run_1",
      document_id: "doc_1",
      draft_id: "draft_1",
      module_id: "mod_1",
      claim_id: "claim_1",
      type: "missing_result",
      severity: "warning",
      title: "缺少结果",
      message: "这条经历看不出业务结果。",
      reason: "需要补充影响范围。",
      actions: [],
      status: "open",
      created_by_agent: "ResumeReviewer",
      evidence_link_ids: ["ev_1"],
      created_at: "2026-05-21T08:00:00.000Z",
    },
  ],
  proposals: [
    {
      id: "prop_1",
      run_id: "run_1",
      document_id: "doc_1",
      draft_id: "draft_1",
      target: { claim_id: "claim_1", module_id: "mod_1" },
      operation: "replace_claim",
      proposed_snapshot: { text: "主导订单系统重构，提升核心链路稳定性。" },
      summary: "改成结果导向表达",
      rationale: "原文只有动作。",
      related_issue_ids: ["issue_1"],
      evidence_link_ids: ["ev_1"],
      confidence: 0.8,
      risk_level: "medium",
      requires_user_confirmation: true,
      status: "pending",
      created_by_agent: "ResumeRewriter",
      created_at: "2026-05-21T08:00:00.000Z",
    },
  ],
  evidence: [
    {
      id: "ev_1",
      document_id: "doc_1",
      source_document_id: "src_1",
      claim_id: "claim_1",
      support_level: "direct",
      extracted_text: "负责核心链路重构。",
      normalized_fact: "负责核心链路重构。",
      confidence: 0.92,
      user_confirmed: false,
      created_at: "2026-05-21T08:00:00.000Z",
    },
  ],
  source_summaries: [
    {
      id: "src_1",
      document_id: "doc_1",
      source_type: "old_resume",
      title: "旧简历粘贴",
      parse_status: "recognized",
      created_at: "2026-05-21T08:00:00.000Z",
    },
  ],
  source_resume_canvas: {
    id: "canvas_1",
    document_id: "doc_1",
    old_resume_source_id: "src_1",
    version: 1,
    source_snapshot_hash: "sha256:seed",
    doc_json: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { canvasNodeId: "node_project", sourceBlockId: "block_project", moduleId: "mod_1" },
          content: [{ type: "text", text: "负责核心链路重构。" }],
        },
      ],
    },
    node_map: [
      {
        canvas_node_id: "node_project",
        source_block_id: "block_project",
        node_type: "paragraph",
        text: "负责核心链路重构。",
        source_span: { line: 1 },
        module_id: "mod_1",
      },
    ],
    module_anchors: [
      {
        module_id: "mod_1",
        canvas_node_ids: ["node_project"],
        title: "项目经历",
        order: 0,
      },
    ],
    created_at: "2026-05-21T08:00:00.000Z",
    updated_at: "2026-05-21T08:00:00.000Z",
  },
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
    summary: "还有 1 个问题建议处理。",
    next_action_ids: ["act_accept_prop_1"],
  },
  available_actions: [
    {
      id: "act_accept_prop_1",
      label: "接受修改",
      action_type: "accept_proposal",
      target: { claim_id: "claim_1", module_id: "mod_1" },
    },
    {
      id: "act_accept_prop_2",
      label: "接受修改",
      action_type: "accept_proposal",
      target: { claim_id: "claim_2", module_id: "mod_1" },
    },
  ],
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/packs/resume/workspaces/doc_1"]}>
      <Routes>
        <Route path="/packs/resume/workspaces/:documentId" element={<RevisionWorkspacePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

function renderPageWithReviewPanelVisible(reviewPanelVisible: boolean) {
  return render(
    <MemoryRouter initialEntries={["/packs/resume/workspaces/doc_1"]}>
      <Routes>
        <Route element={<Outlet context={{ reviewPanelVisible, setReviewPanelVisible: vi.fn() }} />}>
          <Route path="/packs/resume/workspaces/:documentId" element={<RevisionWorkspacePage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

function RouteSwitch() {
  const navigate = useNavigate()
  return <button type="button" onClick={() => navigate("/packs/resume/workspaces/doc_2")}>切换文档</button>
}

function renderPageWithRouteSwitch() {
  return render(
    <MemoryRouter initialEntries={["/packs/resume/workspaces/doc_1"]}>
      <RouteSwitch />
      <Routes>
        <Route path="/packs/resume/workspaces/:documentId" element={<RevisionWorkspacePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

function workspaceForDocument(documentId: string, title: string): WorkspaceView {
  return {
    ...workspace,
    document: { ...workspace.document, id: documentId, title },
    source_resume_canvas: {
      ...workspace.source_resume_canvas!,
      document_id: documentId,
    },
  }
}

function sourceCanvasOnlyWorkspace(
  status: NonNullable<WorkspaceView["run_status"]>["status"],
  text: string,
): WorkspaceView {
  return {
    ...workspace,
    document: {
      ...workspace.document,
      current_draft_id: null,
    },
    current_draft: undefined,
    modules: [],
    claims: [],
    issues: [],
    proposals: [],
    evidence: [],
    source_resume_canvas: {
      ...workspace.source_resume_canvas!,
      doc_json: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text }],
          },
        ],
      },
      module_anchors: [],
    },
    quality_gate: {
      status: "unknown",
      blocking_issue_ids: [],
      warning_issue_ids: [],
    },
    run_status: {
      run_id: "run_import",
      status,
    },
    coach_summary: undefined,
    available_actions: [],
  }
}

function savedCanvasWithLatestText() {
  return {
    ...workspace.source_resume_canvas!,
    doc_json: {
      type: "doc" as const,
      content: [{
        type: "paragraph",
        content: [{ type: "text", text: "负责核心链路重构并提升稳定性。" }],
      }],
    },
    module_anchors: [{
      module_id: "mod_1",
      canvas_node_ids: ["node_project"],
      title: "最新模块",
      order: 0,
    }],
  }
}

function dispatchBeforeUnload() {
  const event = new Event("beforeunload", { cancelable: true })
  window.dispatchEvent(event)
  return event
}

describe("RevisionWorkspacePage", () => {
  beforeEach(() => {
    apiMocks.getRevisionWorkspaceView.mockReset()
    apiMocks.renderRevisionDraft.mockReset()
    apiMocks.acceptRevisionProposal.mockReset()
    apiMocks.rejectRevisionProposal.mockReset()
    apiMocks.dismissRevisionIssue.mockReset()
    apiMocks.runRevisionQualityReview.mockReset()
    apiMocks.createRevisionRun.mockReset()
    apiMocks.calibrateRevisionOpportunity.mockReset()
    apiMocks.exportRevisionDocumentPdf.mockReset()
    apiMocks.exportRevisionDocumentHtml.mockReset()
    apiMocks.saveSourceResumeCanvas.mockReset()
    apiMocks.updateRevisionDocument.mockReset()
    draftCanvasMocks.render.mockReset()
    apiMocks.getRevisionWorkspaceView.mockResolvedValue(workspace)
    apiMocks.acceptRevisionProposal.mockResolvedValue({ id: "prop_1", status: "applied" })
    apiMocks.runRevisionQualityReview.mockResolvedValue({ id: "run_review", status: "completed" })
    apiMocks.createRevisionRun.mockResolvedValue({ id: "run_issue", status: "created" })
    apiMocks.calibrateRevisionOpportunity.mockResolvedValue({ document: { id: "doc_1" } })
    apiMocks.exportRevisionDocumentPdf.mockResolvedValue({ fileName: "resume.pdf", format: "pdf" })
    apiMocks.exportRevisionDocumentHtml.mockResolvedValue({ fileName: "resume.html", format: "html" })
    apiMocks.saveSourceResumeCanvas.mockResolvedValue(workspace.source_resume_canvas)
    apiMocks.updateRevisionDocument.mockResolvedValue({
      ...workspace.document,
      title: "前端负责人简历",
      updated_at: "2026-05-21T08:05:00.000Z",
    })
  })

  it("loads and renders the workspace view", async () => {
    renderPage()

    expect(screen.getByText("加载工作台")).toBeInTheDocument()
    expect(await screen.findByRole("heading", { name: "张三的简历" })).toBeInTheDocument()
    expect(screen.queryByText("completed")).not.toBeInTheDocument()
    expect(screen.getByText("还有 1 个问题建议处理。")).toBeInTheDocument()
    expect(screen.getByText("负责核心链路重构。")).toBeInTheDocument()
    expect(screen.getAllByText("缺少结果").length).toBeGreaterThan(0)
    expect(screen.getAllByText("改成结果导向表达").length).toBeGreaterThan(0)
    const reviewPanel = screen.getByTestId("revision-review-panel")
    const reviewActions = within(reviewPanel).getByTestId("revision-review-actions")
    expect(within(reviewActions).getByRole("button", { name: "质量检查" })).toBeInTheDocument()
    expect(within(reviewActions).getByRole("button", { name: "岗位校准" })).toBeInTheDocument()
    expect(within(reviewActions).queryByRole("button", { name: "导出 PDF" })).not.toBeInTheDocument()
    expect(within(reviewActions).getByText("待处理")).toBeInTheDocument()
    expect(within(screen.getByTestId("revision-workspace-header")).getByRole("button", { name: "导出" })).toBeInTheDocument()
    expect(reviewActions.compareDocumentPosition(within(reviewPanel).getByText("引导")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("edits the workspace title inline", async () => {
    renderPage()

    const titleButton = await screen.findByTestId("revision-workspace-title-button")
    expect(within(titleButton).getByText("张三的简历")).toBeInTheDocument()

    fireEvent.click(titleButton)
    const titleInput = screen.getByLabelText("工作台标题")
    expect(titleInput).toHaveValue("张三的简历")

    fireEvent.change(titleInput, { target: { value: "前端负责人简历" } })
    fireEvent.blur(titleInput)

    await waitFor(() => {
      expect(apiMocks.updateRevisionDocument).toHaveBeenCalledWith("doc_1", { title: "前端负责人简历" })
    })
    expect(await screen.findByRole("heading", { name: "前端负责人简历" })).toBeInTheDocument()
  })

  it("cancels or ignores invalid workspace title edits", async () => {
    renderPage()

    fireEvent.click(await screen.findByTestId("revision-workspace-title-button"))
    let titleInput = screen.getByLabelText("工作台标题")
    fireEvent.change(titleInput, { target: { value: "   " } })
    fireEvent.blur(titleInput)

    expect(apiMocks.updateRevisionDocument).not.toHaveBeenCalled()
    expect(await screen.findByRole("heading", { name: "张三的简历" })).toBeInTheDocument()

    fireEvent.click(screen.getByTestId("revision-workspace-title-button"))
    titleInput = screen.getByLabelText("工作台标题")
    fireEvent.change(titleInput, { target: { value: "不会保存的标题" } })
    fireEvent.keyDown(titleInput, { key: "Escape" })

    expect(apiMocks.updateRevisionDocument).not.toHaveBeenCalled()
    expect(await screen.findByRole("heading", { name: "张三的简历" })).toBeInTheDocument()
  })

  it("renders the source resume canvas instead of iframe preview", async () => {
    renderPage()

    expect(await screen.findByText("负责核心链路重构。")).toBeInTheDocument()
    expect(screen.queryByTitle("结构化草稿预览")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "折叠模块大纲" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "项目经历" })).toBeInTheDocument()
  })

  it("renders the source canvas and recognizing status before a draft exists", async () => {
    apiMocks.getRevisionWorkspaceView.mockResolvedValue(sourceCanvasOnlyWorkspace(
      "recognizing",
      "后台识别中的原始画布",
    ))

    renderPage()

    expect(await screen.findByText("后台识别中的原始画布")).toBeInTheDocument()
    expect(screen.getByText("正在识别模块和建议")).toBeInTheDocument()
    expect(draftCanvasMocks.render).toHaveBeenCalledWith("doc_1")
    const reviewActions = screen.getByTestId("revision-review-actions")
    expect(within(reviewActions).getByRole("button", { name: "质量检查" })).toBeDisabled()
    expect(within(reviewActions).getByRole("button", { name: "岗位校准" })).toBeDisabled()
    expect(within(screen.getByTestId("revision-workspace-header")).getByRole("button", { name: "导出" })).toBeEnabled()
  })

  it("shows a stale source canvas recognition status", async () => {
    apiMocks.getRevisionWorkspaceView.mockResolvedValue(sourceCanvasOnlyWorkspace(
      "stale",
      "更新后的原始画布",
    ))

    renderPage()

    expect(await screen.findByText("更新后的原始画布")).toBeInTheDocument()
    expect(screen.getByText("源画布已更新，需要重新识别")).toBeInTheDocument()
  })

  it("debounces source canvas autosave and announces success", async () => {
    renderPage()
    await screen.findByText("负责核心链路重构。")
    vi.useFakeTimers()

    try {
      fireEvent.click(screen.getByRole("button", { name: "编辑原始画布" }))
      expect(apiMocks.saveSourceResumeCanvas).not.toHaveBeenCalled()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(600)
      })

      expect(apiMocks.saveSourceResumeCanvas).toHaveBeenCalledTimes(1)
      expect(apiMocks.saveSourceResumeCanvas).toHaveBeenCalledWith("doc_1", expect.objectContaining({ type: "doc" }))
      expect(JSON.stringify(apiMocks.saveSourceResumeCanvas.mock.calls[0]?.[1])).not.toMatch(
        /activeModuleId|outline|position/,
      )
      expect(screen.getByText("已保存")).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it("keeps local canvas text and retries a failed autosave explicitly", async () => {
    apiMocks.saveSourceResumeCanvas.mockRejectedValueOnce(new Error("save failed"))
    renderPage()
    await screen.findByText("负责核心链路重构。")
    vi.useFakeTimers()

    try {
      fireEvent.click(screen.getByRole("button", { name: "编辑原始画布" }))

      await act(async () => {
        await vi.advanceTimersByTimeAsync(600)
      })

      expect(screen.getByText("保存失败")).toBeInTheDocument()
      expect(screen.getByText("负责核心链路重构并提升稳定性。")).toBeInTheDocument()

      fireEvent.click(screen.getByRole("button", { name: "重试保存" }))

      await act(async () => {
        await Promise.resolve()
      })
      expect(apiMocks.saveSourceResumeCanvas).toHaveBeenCalledTimes(2)
      expect(screen.getByText("已保存")).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it("serializes autosaves and drains the latest local canvas after the in-flight save", async () => {
    let resolveFirstSave: (canvas: NonNullable<WorkspaceView["source_resume_canvas"]>) => void = () => {}
    let resolveSecondSave: (canvas: NonNullable<WorkspaceView["source_resume_canvas"]>) => void = () => {}
    apiMocks.saveSourceResumeCanvas
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirstSave = resolve
      }))
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveSecondSave = resolve
      }))
    renderPage()
    await screen.findByText("负责核心链路重构。")
    vi.useFakeTimers()

    try {
      fireEvent.click(screen.getByRole("button", { name: "编辑原始画布" }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600)
      })
      fireEvent.click(screen.getByRole("button", { name: "再次编辑原始画布" }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600)
      })
      expect(apiMocks.saveSourceResumeCanvas).toHaveBeenCalledTimes(1)

      await act(async () => {
        resolveFirstSave({
          ...workspace.source_resume_canvas!,
          doc_json: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: "旧响应正文" }] }],
          },
        })
      })
      expect(apiMocks.saveSourceResumeCanvas).toHaveBeenCalledTimes(2)
      expect(screen.getByText("负责核心链路重构并提升稳定性与可观测性。")).toBeInTheDocument()

      await act(async () => {
        resolveSecondSave({
          ...workspace.source_resume_canvas!,
          doc_json: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: "负责核心链路重构并提升稳定性与可观测性。" }] }],
          },
        })
      })
      expect(screen.getByText("已保存")).toBeInTheDocument()
      expect(screen.queryByText("旧响应正文")).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it("flushes pending canvas text before refreshing the workspace", async () => {
    let resolveSave: (canvas: NonNullable<WorkspaceView["source_resume_canvas"]>) => void = () => {}
    apiMocks.saveSourceResumeCanvas.mockImplementationOnce(() => new Promise((resolve) => {
      resolveSave = resolve
    }))
    renderPage()
    await screen.findByText("负责核心链路重构。")

    fireEvent.click(screen.getByRole("button", { name: "编辑原始画布" }))
    fireEvent.click(screen.getByRole("button", { name: "质量检查" }))

    await waitFor(() => expect(apiMocks.saveSourceResumeCanvas).toHaveBeenCalledTimes(1))
    expect(apiMocks.getRevisionWorkspaceView).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveSave(workspace.source_resume_canvas!)
    })

    await waitFor(() => expect(apiMocks.getRevisionWorkspaceView).toHaveBeenCalledTimes(2))
  })

  it("keeps unload protection while an unmounted cleanup save is pending", async () => {
    let resolveSave: (canvas: NonNullable<WorkspaceView["source_resume_canvas"]>) => void = () => {}
    apiMocks.saveSourceResumeCanvas.mockImplementationOnce(() => new Promise((resolve) => {
      resolveSave = resolve
    }))
    const { unmount } = renderPage()
    await screen.findByText("负责核心链路重构。")

    fireEvent.click(screen.getByRole("button", { name: "编辑原始画布" }))
    unmount()

    expect(apiMocks.saveSourceResumeCanvas).toHaveBeenCalledTimes(1)
    const pendingUnloadPrevented = dispatchBeforeUnload().defaultPrevented

    await act(async () => {
      resolveSave(savedCanvasWithLatestText())
    })
    expect(pendingUnloadPrevented).toBe(true)
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false)
  })

  it("waits for a cleanup save before loading a remounted workspace for the same document", async () => {
    let resolveFirstSave: (canvas: NonNullable<WorkspaceView["source_resume_canvas"]>) => void = () => {}
    apiMocks.saveSourceResumeCanvas.mockImplementationOnce(() => new Promise((resolve) => {
      resolveFirstSave = resolve
    }))
    const firstPage = renderPage()
    await screen.findByText("负责核心链路重构。")
    fireEvent.click(screen.getByRole("button", { name: "编辑原始画布" }))
    firstPage.unmount()
    expect(apiMocks.saveSourceResumeCanvas).toHaveBeenCalledTimes(1)

    const secondPage = renderPage()
    try {
      expect(apiMocks.getRevisionWorkspaceView).toHaveBeenCalledTimes(1)

      await act(async () => {
        resolveFirstSave(savedCanvasWithLatestText())
      })

      await waitFor(() => expect(apiMocks.getRevisionWorkspaceView).toHaveBeenCalledTimes(2))
      expect(await screen.findByText("负责核心链路重构并提升稳定性。")).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "最新模块" })).toBeInTheDocument()
    } finally {
      await act(async () => {
        resolveFirstSave(savedCanvasWithLatestText())
        await Promise.resolve()
      })
      secondPage.unmount()
    }
  })

  it("does not implicitly retry a failed save while refreshing or unmounting", async () => {
    apiMocks.saveSourceResumeCanvas.mockRejectedValueOnce(new Error("save failed"))
    const page = renderPage()
    await screen.findByText("负责核心链路重构。")
    vi.useFakeTimers()

    try {
      fireEvent.click(screen.getByRole("button", { name: "编辑原始画布" }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600)
      })
      expect(screen.getByText("保存失败")).toBeInTheDocument()

      fireEvent.click(screen.getByRole("button", { name: "质量检查" }))
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(apiMocks.getRevisionWorkspaceView).toHaveBeenCalledTimes(2)
      expect(apiMocks.saveSourceResumeCanvas).toHaveBeenCalledTimes(1)

      page.unmount()
      expect(apiMocks.saveSourceResumeCanvas).toHaveBeenCalledTimes(1)

      const recoveryPage = renderPage()
      vi.useRealTimers()
      expect(await screen.findByText("保存失败")).toBeInTheDocument()
      fireEvent.click(screen.getByRole("button", { name: "重试保存" }))
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(apiMocks.saveSourceResumeCanvas).toHaveBeenCalledTimes(2)
      recoveryPage.unmount()
    } finally {
      page.unmount()
      vi.useRealTimers()
    }
  })

  it("restores a failed cleanup save after remount and retries it explicitly", async () => {
    apiMocks.saveSourceResumeCanvas
      .mockRejectedValueOnce(new Error("save failed"))
      .mockResolvedValueOnce(savedCanvasWithLatestText())
    const firstPage = renderPage()
    await screen.findByText("负责核心链路重构。")
    fireEvent.click(screen.getByRole("button", { name: "编辑原始画布" }))
    firstPage.unmount()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    const failedUnloadPrevented = dispatchBeforeUnload().defaultPrevented

    const secondPage = renderPage()
    try {
      expect(await screen.findByText("负责核心链路重构并提升稳定性。")).toBeInTheDocument()
      expect(screen.getByText("保存失败")).toBeInTheDocument()

      fireEvent.click(screen.getByRole("button", { name: "重试保存" }))

      await waitFor(() => expect(apiMocks.saveSourceResumeCanvas).toHaveBeenCalledTimes(2))
      expect(screen.getByText("已保存")).toBeInTheDocument()
    } finally {
      secondPage.unmount()
    }
    expect(failedUnloadPrevented).toBe(true)
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false)
  })

  it("prevents unload while a canvas save is pending", async () => {
    renderPage()
    await screen.findByText("负责核心链路重构。")

    fireEvent.click(screen.getByRole("button", { name: "编辑原始画布" }))
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true)
  })

  it("does not render an old workspace canvas after the route document changes", async () => {
    let resolveSecondWorkspace: (nextWorkspace: WorkspaceView) => void = () => {}
    apiMocks.getRevisionWorkspaceView.mockImplementation((documentId: string) => {
      if (documentId === "doc_1") return Promise.resolve(workspace)
      return new Promise((resolve) => {
        resolveSecondWorkspace = resolve
      })
    })
    renderPageWithRouteSwitch()
    await screen.findByText("负责核心链路重构。")
    draftCanvasMocks.render.mockClear()

    try {
      fireEvent.click(screen.getByRole("button", { name: "切换文档" }))

      expect(draftCanvasMocks.render).not.toHaveBeenCalled()
      expect(screen.queryByRole("button", { name: "编辑原始画布" })).not.toBeInTheDocument()
    } finally {
      await waitFor(() => {
        expect(apiMocks.getRevisionWorkspaceView).toHaveBeenCalledWith("doc_2")
      })
      await act(async () => {
        resolveSecondWorkspace(workspaceForDocument("doc_2", "李四的简历"))
      })
    }

    expect(await screen.findByRole("heading", { name: "李四的简历" })).toBeInTheDocument()
  })

  it("drops an old refresh continuation when the route changes during flush", async () => {
    let resolveSave: (canvas: NonNullable<WorkspaceView["source_resume_canvas"]>) => void = () => {}
    apiMocks.saveSourceResumeCanvas.mockImplementationOnce(() => new Promise((resolve) => {
      resolveSave = resolve
    }))
    apiMocks.getRevisionWorkspaceView.mockImplementation((documentId: string) => (
      Promise.resolve(documentId === "doc_1" ? workspace : workspaceForDocument("doc_2", "李四的简历"))
    ))
    renderPageWithRouteSwitch()
    await screen.findByText("负责核心链路重构。")

    fireEvent.click(screen.getByRole("button", { name: "编辑原始画布" }))
    fireEvent.click(screen.getByRole("button", { name: "质量检查" }))
    await waitFor(() => expect(apiMocks.saveSourceResumeCanvas).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole("button", { name: "切换文档" }))
    expect(await screen.findByRole("heading", { name: "李四的简历" })).toBeInTheDocument()

    await act(async () => {
      resolveSave(savedCanvasWithLatestText())
    })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(apiMocks.getRevisionWorkspaceView.mock.calls.map(([documentId]) => documentId)).toEqual(["doc_1", "doc_2"])
    expect(screen.getByRole("heading", { name: "李四的简历" })).toBeInTheDocument()
  })

  it("runs an available proposal action and refreshes the workspace", async () => {
    renderPage()

    const acceptButtons = await screen.findAllByRole("button", { name: /接受修改/ })
    fireEvent.click(acceptButtons[0])

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

  it("exports from the title bar with current canvas and page margins", async () => {
    renderPage()

    fireEvent.click(await screen.findByRole("button", { name: "调整页边距" }))
    fireEvent.keyDown(await screen.findByRole("button", { name: "导出" }), { key: "ArrowDown" })
    fireEvent.click(await screen.findByRole("menuitem", { name: "导出 PDF" }))

    await waitFor(() => expect(apiMocks.exportRevisionDocumentPdf).toHaveBeenCalledWith(
      "doc_1",
      "张三的简历",
      expect.objectContaining({
        docJson: workspace.source_resume_canvas?.doc_json,
        pageMargins: { top: 88, bottom: 72, left: 42, right: 48 },
        templateStyle: expect.objectContaining({ template_id: "classic-a4" }),
      }),
    ))
  })

  it("exports HTML from the title bar menu with current canvas style", async () => {
    renderPage()

    fireEvent.keyDown(await screen.findByRole("button", { name: "导出" }), { key: "ArrowDown" })
    fireEvent.click(await screen.findByRole("menuitem", { name: "导出 HTML" }))

    await waitFor(() => expect(apiMocks.exportRevisionDocumentHtml).toHaveBeenCalledWith(
      "doc_1",
      "张三的简历",
      expect.objectContaining({
        docJson: workspace.source_resume_canvas?.doc_json,
        pageMargins: { top: 76, bottom: 76, left: 50, right: 50 },
        templateStyle: expect.objectContaining({ template_id: "classic-a4" }),
      }),
    ))
  })

  it("opens contextual issue detail with related proposal actions", async () => {
    renderPage()

    fireEvent.click(await screen.findByRole("button", { name: /缺少结果/ }))

    const detail = await screen.findByRole("region", { name: "问题处理详情" })
    expect(within(detail).getByRole("heading", { name: "缺少结果" })).toBeInTheDocument()
    expect(within(detail).getByText("影响模块：项目经历")).toBeInTheDocument()
    expect(within(detail).getByText("需要补充影响范围。")).toBeInTheDocument()
    expect(within(detail).getByText("当前依据")).toBeInTheDocument()
    expect(within(detail).getByText("原始主张：负责核心链路重构。")).toBeInTheDocument()
    expect(within(detail).getByText("来源：旧简历粘贴")).toBeInTheDocument()
    expect(within(detail).getByText("原文：负责核心链路重构。")).toBeInTheDocument()
    expect(within(detail).getByText("改成结果导向表达")).toBeInTheDocument()
    expect(within(detail).getAllByRole("button", { name: /接受修改/ })).toHaveLength(1)

    fireEvent.click(within(detail).getByRole("button", { name: /接受修改/ }))
    await waitFor(() => expect(apiMocks.acceptRevisionProposal).toHaveBeenCalledWith("prop_1"))
  })

  it("defaults to the first issue and keeps local actions out of global next steps", async () => {
    renderPage()

    const detail = await screen.findByRole("region", { name: "问题处理详情" })

    expect(within(detail).getByRole("heading", { name: "缺少结果" })).toBeInTheDocument()
    expect(screen.getByTestId("revision-issue-issue_1")).toHaveAttribute("aria-pressed", "true")
    expect(screen.getAllByRole("button", { name: /接受修改/ })).toHaveLength(1)
  })

  it("submits contextual issue input as an issue action run", async () => {
    renderPage()

    const detail = await screen.findByRole("region", { name: "问题处理详情" })
    fireEvent.change(within(detail).getByLabelText("补充事实"), {
      target: { value: "这个项目让接口错误率下降 30%。" },
    })
    fireEvent.click(within(detail).getByRole("button", { name: "提交补充" }))

    await waitFor(() => {
      expect(apiMocks.createRevisionRun).toHaveBeenCalledWith("doc_1", {
        run_type: "issue_action",
        base_draft_id: "draft_1",
        selected_module_id: "mod_1",
        selected_issue_id: "issue_1",
        user_intent: "这个项目让接口错误率下降 30%。",
      })
    })
    await waitFor(() => expect(apiMocks.getRevisionWorkspaceView).toHaveBeenCalledTimes(2))
  })

  it("keeps draft and review columns visible on compact viewports", async () => {
    renderPage()

    const workspaceGrid = await screen.findByTestId("revision-workspace-grid")
    const draftPanel = await screen.findByTestId("revision-draft-panel")
    const reviewPanel = screen.getByTestId("revision-review-panel")
    const issueButton = await screen.findByTestId("revision-issue-issue_1")

    fireEvent.click(issueButton)

    expect(workspaceGrid).toHaveClass("grid-cols-[minmax(0,1fr)_360px]")
    expect(screen.queryByTestId("revision-mobile-draft-tab")).not.toBeInTheDocument()
    expect(screen.queryByTestId("revision-mobile-review-tab")).not.toBeInTheDocument()
    expect(draftPanel).not.toHaveClass("hidden")
    expect(reviewPanel).not.toHaveClass("hidden")
    expect(screen.getByTestId("revision-issue-issue_1")).toHaveAttribute("aria-pressed", "true")
  })

  it("removes the review column when the chrome review panel is hidden", async () => {
    renderPageWithReviewPanelVisible(false)

    const workspaceGrid = await screen.findByTestId("revision-workspace-grid")
    const draftPanel = screen.getByTestId("revision-draft-panel")
    const reviewPanel = screen.getByTestId("revision-review-panel")

    expect(workspaceGrid).toHaveClass("grid-cols-[minmax(0,1fr)]")
    expect(workspaceGrid).not.toHaveClass("grid-cols-[minmax(0,1fr)_360px]")
    expect(workspaceGrid).toHaveClass("overflow-hidden")
    expect(draftPanel).toHaveClass("overflow-hidden")
    expect(draftPanel).toHaveClass("pt-0")
    expect(draftPanel).toHaveClass("px-0")
    expect(reviewPanel).toHaveClass("overflow-y-auto")
    expect(draftPanel).not.toHaveClass("hidden")
    expect(reviewPanel).toHaveClass("hidden")
    expect(screen.queryByTestId("revision-mobile-draft-tab")).not.toBeInTheDocument()
    expect(screen.queryByTestId("revision-mobile-review-tab")).not.toBeInTheDocument()
  })
})
