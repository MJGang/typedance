import "@testing-library/jest-dom/vitest"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { useState, type ReactNode } from "react"
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ContextSource, ContextSourceChild, WorkspaceView } from "@typedance/contracts"
import { TooltipProvider } from "@/components/ui/tooltip"
import { RevisionWorkspacePage } from "./RevisionWorkspacePage"

const apiMocks = vi.hoisted(() => ({
  getRevisionWorkspaceView: vi.fn(),
  exportRevisionDocumentPdf: vi.fn(),
  exportRevisionDocumentHtml: vi.fn(),
  saveSourceResumeCanvas: vi.fn(),
  updateRevisionDocument: vi.fn(),
  listContextSources: vi.fn(),
  addFileContextSource: vi.fn(),
  addDirectoryContextSource: vi.fn(),
  addWebpageContextSource: vi.fn(),
  updateContextSourceTitle: vi.fn(),
  removeContextSource: vi.fn(),
  listContextSourceChildren: vi.fn(),
  refreshContextSource: vi.fn(),
  openContextSource: vi.fn(),
  revealContextSource: vi.fn(),
  openContextSourceChild: vi.fn(),
  revealContextSourceChild: vi.fn(),
}))

const agentHostMocks = vi.hoisted(() => ({
  listWorkspaceConversations: vi.fn(),
  createWorkspaceConversation: vi.fn(),
  updateWorkspaceConversation: vi.fn(),
  deleteWorkspaceConversation: vi.fn(),
  listWorkspacePlugins: vi.fn(),
  listConversationMessages: vi.fn(),
  startConversationRun: vi.fn(),
  listAgentRunEvents: vi.fn(),
  createAgentRunEventSource: vi.fn(),
}))

const draftCanvasMocks = vi.hoisted(() => ({
  render: vi.fn(),
}))

vi.mock("@assistant-ui/react", () => ({
  AssistantRuntimeProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useLocalRuntime: () => ({}),
}))

vi.mock("@/api", () => ({
  getRevisionWorkspaceView: (...args: unknown[]) => apiMocks.getRevisionWorkspaceView(...args),
  exportRevisionDocumentPdf: (...args: unknown[]) => apiMocks.exportRevisionDocumentPdf(...args),
  exportRevisionDocumentHtml: (...args: unknown[]) => apiMocks.exportRevisionDocumentHtml(...args),
  saveSourceResumeCanvas: (...args: unknown[]) => apiMocks.saveSourceResumeCanvas(...args),
  updateRevisionDocument: (...args: unknown[]) => apiMocks.updateRevisionDocument(...args),
  listContextSources: (...args: unknown[]) => apiMocks.listContextSources(...args),
  addFileContextSource: (...args: unknown[]) => apiMocks.addFileContextSource(...args),
  addDirectoryContextSource: (...args: unknown[]) => apiMocks.addDirectoryContextSource(...args),
  addWebpageContextSource: (...args: unknown[]) => apiMocks.addWebpageContextSource(...args),
  updateContextSourceTitle: (...args: unknown[]) => apiMocks.updateContextSourceTitle(...args),
  removeContextSource: (...args: unknown[]) => apiMocks.removeContextSource(...args),
  listContextSourceChildren: (...args: unknown[]) => apiMocks.listContextSourceChildren(...args),
  refreshContextSource: (...args: unknown[]) => apiMocks.refreshContextSource(...args),
  openContextSource: (...args: unknown[]) => apiMocks.openContextSource(...args),
  revealContextSource: (...args: unknown[]) => apiMocks.revealContextSource(...args),
  openContextSourceChild: (...args: unknown[]) => apiMocks.openContextSourceChild(...args),
  revealContextSourceChild: (...args: unknown[]) => apiMocks.revealContextSourceChild(...args),
}))

vi.mock("@/agentHost", () => ({
  listWorkspaceConversations: (...args: unknown[]) => agentHostMocks.listWorkspaceConversations(...args),
  createWorkspaceConversation: (...args: unknown[]) => agentHostMocks.createWorkspaceConversation(...args),
  updateWorkspaceConversation: (...args: unknown[]) => agentHostMocks.updateWorkspaceConversation(...args),
  deleteWorkspaceConversation: (...args: unknown[]) => agentHostMocks.deleteWorkspaceConversation(...args),
  listWorkspacePlugins: (...args: unknown[]) => agentHostMocks.listWorkspacePlugins(...args),
  listConversationMessages: (...args: unknown[]) => agentHostMocks.listConversationMessages(...args),
  startConversationRun: (...args: unknown[]) => agentHostMocks.startConversationRun(...args),
  listAgentRunEvents: (...args: unknown[]) => agentHostMocks.listAgentRunEvents(...args),
  createAgentRunEventSource: (...args: unknown[]) => agentHostMocks.createAgentRunEventSource(...args),
}))

vi.mock("@/tauri", () => ({
  isTauri: () => false,
  chooseContextDirectoryPathInTauri: vi.fn(),
  chooseContextFilePathsInTauri: vi.fn(),
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
    toolbarEnd,
  }: {
    canvas: WorkspaceView["source_resume_canvas"]
    onChange: (change: { plainText: string; docJson: { type: "doc"; content: unknown[] } }) => void
    onPageMarginsChange?: (margins: { top: number; bottom: number; left: number; right: number }) => void
    onRetrySave: () => void
    saveStatus: "idle" | "saving" | "saved" | "error"
    toolbarEnd?: ReactNode
  }) => (
    draftCanvasMocks.render(canvas?.document_id),
    <section aria-label="原始简历画布">
      <div role="toolbar" aria-label="简历格式工具栏">{toolbarEnd}</div>
      <p>{canvasText(canvas?.doc_json)}</p>
      {canvas?.module_anchors.map((anchor) => <button key={anchor.module_id} type="button">{anchor.title}</button>)}
      <button
        type="button"
        onClick={() => onChange({
          plainText: "Updated canvas text",
          docJson: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: "Updated canvas text" }] }],
          },
        })}
      >
        编辑画布
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
    title: "旧简历重构1",
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
    unresolved_issue_ids: [],
    variant_type: "base",
    created_at: "2026-05-21T08:00:00.000Z",
    updated_at: "2026-05-21T08:00:00.000Z",
  },
  modules: [],
  claims: [],
  issues: [],
  proposals: [],
  evidence: [],
  source_summaries: [],
  source_resume_canvas: {
    id: "canvas_1",
    document_id: "doc_1",
    old_resume_source_id: "src_1",
    version: 1,
    source_snapshot_hash: "sha256:seed",
    doc_json: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Original canvas text" }] }],
    },
    node_map: [],
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
    warning_issue_ids: [],
  },
  coach_summary: undefined,
  available_actions: [],
}

const contextSources: ContextSource[] = [
  {
    id: "ctx_dir",
    workspace_id: "doc_1",
    type: "directory",
    title: "materials",
    uri: "file:///E:/materials",
    metadata: { permission: "read" },
    created_at: "2026-05-21T08:00:00.000Z",
    updated_at: "2026-05-21T08:00:00.000Z",
  },
  {
    id: "ctx_web",
    workspace_id: "doc_1",
    type: "webpage",
    title: "Frontend JD",
    uri: "https://example.com/jobs/frontend",
    description: "React and TypeScript role",
    summary: "A frontend job description",
    favicon_url: "https://example.com/favicon.ico",
    metadata: {},
    created_at: "2026-05-21T08:00:00.000Z",
    updated_at: "2026-05-21T08:00:00.000Z",
  },
]

const directoryChildren: ContextSourceChild[] = [
  {
    type: "file",
    name: "jd.md",
    path: "nested/jd.md",
    uri: "file:///E:/materials/nested/jd.md",
    size: 12,
    updated_at: "2026-05-21T08:00:00.000Z",
  },
]

function ChromeHarness({ assistantVisible, sidebarVisible }: { assistantVisible: boolean; sidebarVisible: boolean }) {
  const [assistantPanelVisible, setAssistantPanelVisible] = useState(assistantVisible)
  const [workbenchSidebarVisible, setWorkbenchSidebarVisible] = useState(sidebarVisible)

  return (
    <Outlet context={{
      assistantPanelVisible,
      setAssistantPanelVisible,
      workbenchSidebarVisible,
      setWorkbenchSidebarVisible,
    }} />
  )
}

function renderPage(assistantPanelVisible = true, workbenchSidebarVisible = true) {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={["/packs/resume/workspaces/doc_1"]}>
        <Routes>
          <Route element={<ChromeHarness assistantVisible={assistantPanelVisible} sidebarVisible={workbenchSidebarVisible} />}>
            <Route path="/packs/resume/workspaces/:documentId" element={<RevisionWorkspacePage />} />
            <Route path="/packs/resume/workspaces" element={<div>工作区列表</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  )
}

function typeComposerText(composer: HTMLElement, value: string) {
  composer.textContent = value
  composer.focus()

  const range = document.createRange()
  const textNode = composer.firstChild ?? composer.appendChild(document.createTextNode(""))
  range.setStart(textNode, value.length)
  range.collapse(true)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)

  fireEvent.input(composer)
}

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  globalThis.ResizeObserver = ResizeObserverMock
})

describe("RevisionWorkspacePage", () => {
  beforeEach(() => {
    vi.useRealTimers()
    Object.values(apiMocks).forEach((mock) => mock.mockReset())
    Object.values(agentHostMocks).forEach((mock) => mock.mockReset())
    draftCanvasMocks.render.mockReset()

    apiMocks.getRevisionWorkspaceView.mockResolvedValue(workspace)
    apiMocks.exportRevisionDocumentPdf.mockResolvedValue({ fileName: "resume.pdf", format: "pdf" })
    apiMocks.exportRevisionDocumentHtml.mockResolvedValue({ fileName: "resume.html", format: "html" })
    apiMocks.saveSourceResumeCanvas.mockImplementation(async (documentId: string, docJson: Record<string, unknown>) => ({
      ...workspace.source_resume_canvas!,
      document_id: documentId,
      doc_json: docJson,
      updated_at: "2026-05-21T08:06:00.000Z",
    }))
    apiMocks.updateRevisionDocument.mockResolvedValue({
      ...workspace.document,
      title: "前端负责人简历",
      updated_at: "2026-05-21T08:05:00.000Z",
    })
    apiMocks.listContextSources.mockResolvedValue(contextSources)
    apiMocks.listContextSourceChildren.mockResolvedValue(directoryChildren)
    apiMocks.addFileContextSource.mockResolvedValue(contextSources[0])
    apiMocks.addDirectoryContextSource.mockResolvedValue(contextSources[0])
    apiMocks.addWebpageContextSource.mockResolvedValue(contextSources[1])
    apiMocks.updateContextSourceTitle.mockResolvedValue(contextSources[1])
    apiMocks.refreshContextSource.mockResolvedValue(contextSources[1])

    agentHostMocks.listWorkspaceConversations.mockResolvedValue([
      {
        id: "conv_1",
        workspace_id: "doc_1",
        name: "优化简历",
        preview: "",
        pinned: false,
        status: "idle",
        last_message_at: "2026-05-21T08:00:00.000Z",
        created_at: "2026-05-21T08:00:00.000Z",
        updated_at: "2026-05-21T08:00:00.000Z",
      },
    ])
    agentHostMocks.createWorkspaceConversation.mockResolvedValue({
      id: "conv_new",
      workspace_id: "doc_1",
      name: null,
      preview: "",
      pinned: false,
      status: "idle",
      created_at: "2026-05-21T08:00:00.000Z",
      updated_at: "2026-05-21T08:00:00.000Z",
    })
    agentHostMocks.listWorkspacePlugins.mockResolvedValue([])
    agentHostMocks.listConversationMessages.mockResolvedValue([])
    agentHostMocks.listAgentRunEvents.mockResolvedValue([])
  })

  it("loads the route-level workbench with context, canvas, and AI chat", async () => {
    renderPage()

    expect(screen.getByText("加载工作台")).toBeInTheDocument()
    expect(await screen.findByTestId("revision-draft-panel")).toBeInTheDocument()
    expect(screen.getAllByText("旧简历重构1")).toHaveLength(1)
    expect(screen.queryByText("工作区")).not.toBeInTheDocument()
    expect(screen.queryByTestId("revision-workspace-header")).not.toBeInTheDocument()
    expect(screen.getByText("上下文")).toBeInTheDocument()
    expect(screen.getByText("对话")).toBeInTheDocument()
    expect(screen.getByText("未选择对话")).toBeInTheDocument()
    expect(screen.queryByText("AI 助手")).not.toBeInTheDocument()
    expect(screen.getByText("Original canvas text")).toBeInTheDocument()
    expect(screen.queryByTestId("revision-review-panel")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "质量检查" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "岗位校准" })).not.toBeInTheDocument()

    await waitFor(() => expect(apiMocks.listContextSources).toHaveBeenCalledWith("doc_1"))
    await waitFor(() => expect(agentHostMocks.listWorkspaceConversations).toHaveBeenCalledWith("doc_1"))
  })

  it("hides and restores the assistant panel from workbench controls", async () => {
    renderPage()

    const workspaceGrid = await screen.findByTestId("revision-workspace-grid")
    fireEvent.click(await screen.findByRole("button", { name: "隐藏 AI 面板" }))
    expect(workspaceGrid).toHaveClass("grid-cols-[minmax(0,1fr)]")
    expect(workspaceGrid).not.toHaveClass("grid-cols-[minmax(48rem,1fr)_24rem]")
    expect(screen.queryByRole("button", { name: "隐藏 AI 面板" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "显示 AI 面板" }))
    expect(await screen.findByRole("button", { name: "隐藏 AI 面板" })).toBeInTheDocument()
    expect(workspaceGrid).toHaveClass("grid-cols-[minmax(48rem,1fr)_24rem]")
  })

  it("removes the workbench sidebar when the global shell hides the left navigation", async () => {
    renderPage(true, false)

    expect(await screen.findByTestId("revision-draft-panel")).toBeInTheDocument()
    expect(screen.queryByText("上下文")).not.toBeInTheDocument()
  })

  it("lazily expands local directory context sources", async () => {
    renderPage()

    const materials = await screen.findByRole("button", { name: "materials" })
    fireEvent.click(materials)

    await waitFor(() => expect(apiMocks.listContextSourceChildren).toHaveBeenCalledWith("ctx_dir"))
    expect(await screen.findByText("jd.md")).toBeInTheDocument()
  })

  it("creates and selects a new conversation from the workbench sidebar", async () => {
    renderPage()

    fireEvent.click(await screen.findByRole("button", { name: "新对话" }))

    await waitFor(() => expect(agentHostMocks.createWorkspaceConversation).toHaveBeenCalledWith("doc_1"))
    await waitFor(() => expect(agentHostMocks.listWorkspaceConversations).toHaveBeenCalledTimes(2))
  })

  it("clears the active conversation when the selected conversation is deleted", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true)
    agentHostMocks.listWorkspaceConversations
      .mockResolvedValueOnce([
        {
          id: "conv_1",
          workspace_id: "doc_1",
          name: "Optimize resume",
          preview: "",
          pinned: false,
          status: "idle",
          last_message_at: "2026-05-21T08:00:00.000Z",
          created_at: "2026-05-21T08:00:00.000Z",
          updated_at: "2026-05-21T08:00:00.000Z",
        },
      ])
      .mockResolvedValue([])
    agentHostMocks.listConversationMessages.mockResolvedValue([
      {
        id: "msg_user",
        conversation_id: "conv_1",
        role: "user",
        content: "Check this resume",
        mentions: [],
        created_at: "2026-05-21T08:01:00.000Z",
      },
      {
        id: "msg_assistant",
        conversation_id: "conv_1",
        role: "assistant",
        content: "Assistant answer",
        mentions: [],
        created_at: "2026-05-21T08:02:00.000Z",
      },
    ])
    agentHostMocks.deleteWorkspaceConversation.mockResolvedValue(undefined)

    renderPage()

    fireEvent.click(await screen.findByRole("button", { name: "Optimize resume" }))
    expect(await screen.findByText("Assistant answer")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "删除对话" }))

    await waitFor(() => expect(agentHostMocks.deleteWorkspaceConversation).toHaveBeenCalledWith("conv_1"))
    await waitFor(() => expect(screen.queryByText("Assistant answer")).not.toBeInTheDocument())
    expect(screen.getByText("未选择对话")).toBeInTheDocument()

    confirmSpy.mockRestore()
  })

  it("refreshes the sidebar conversation preview immediately after sending", async () => {
    agentHostMocks.listWorkspaceConversations
      .mockResolvedValue([
        {
          id: "conv_1",
          workspace_id: "doc_1",
          name: null,
          preview: "Check title refresh",
          first_user_message: "Check title refresh",
          pinned: false,
          status: "running",
          last_message_at: "2026-05-21T08:01:00.000Z",
          created_at: "2026-05-21T08:00:00.000Z",
          updated_at: "2026-05-21T08:01:00.000Z",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "conv_1",
          workspace_id: "doc_1",
          name: null,
          preview: "",
          pinned: false,
          status: "idle",
          last_message_at: "2026-05-21T08:00:00.000Z",
          created_at: "2026-05-21T08:00:00.000Z",
          updated_at: "2026-05-21T08:00:00.000Z",
        },
      ])
    agentHostMocks.startConversationRun.mockResolvedValue({
      id: "run_1",
      conversation_id: "conv_1",
      assistant_message_id: "msg_assistant",
      status: "running",
      model: "deepseek-v4-flash",
      mutation_mode: "review",
      started_at: "2026-05-21T08:00:00.000Z",
    })
    agentHostMocks.listConversationMessages.mockResolvedValue([])

    renderPage()

    fireEvent.click(await screen.findByRole("button", { name: "新对话" }))
    const composer = screen.getByRole("textbox")
    typeComposerText(composer, "Check title refresh")
    fireEvent.keyDown(composer, { key: "Enter" })

    await waitFor(() => expect(agentHostMocks.createAgentRunEventSource).toHaveBeenCalledWith("run_1"))
    await waitFor(() => expect(agentHostMocks.listWorkspaceConversations.mock.calls.length).toBeGreaterThanOrEqual(2))
    const refreshedConversation = await screen.findByRole("button", { name: "Check title refresh" })
    expect(refreshedConversation).toHaveClass("truncate")
  })

  it("edits the workspace title inline", async () => {
    renderPage()

    const titleButton = await screen.findByTestId("revision-workspace-title-button")
    fireEvent.click(titleButton)
    const titleInput = screen.getByLabelText("工作区标题")
    expect(screen.getByText("6/10")).toBeInTheDocument()
    fireEvent.change(titleInput, { target: { value: "一二三四五六七八九十十一" } })
    expect(titleInput).toHaveValue("一二三四五六七八九十")
    expect(screen.getByText("10/10")).toBeInTheDocument()
    fireEvent.blur(titleInput)

    await waitFor(() => {
      expect(apiMocks.updateRevisionDocument).toHaveBeenCalledWith("doc_1", { title: "一二三四五六七八九十" })
    })
  })

  it("does not keep a duplicate return action in the workbench sidebar", async () => {
    renderPage()

    expect(await screen.findByTestId("revision-draft-panel")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "返回工作区列表" })).not.toBeInTheDocument()
  })

  it("exports from the editor toolbar with current canvas and page margins", async () => {
    renderPage()

    fireEvent.click(await screen.findByRole("button", { name: "调整页边距" }))
    const toolbar = await screen.findByRole("toolbar", { name: "简历格式工具栏" })
    const exportButton = within(toolbar).getByRole("button", { name: "导出" })
    expect(exportButton).not.toHaveTextContent("导出")
    fireEvent.keyDown(exportButton, { key: "ArrowDown" })
    fireEvent.click(await screen.findByRole("menuitem", { name: "导出 PDF" }))

    await waitFor(() => expect(apiMocks.exportRevisionDocumentPdf).toHaveBeenCalledWith(
      "doc_1",
      "旧简历重构1",
      expect.objectContaining({
        docJson: workspace.source_resume_canvas?.doc_json,
        pageMargins: { top: 88, bottom: 72, left: 42, right: 48 },
        templateStyle: expect.objectContaining({ template_id: "classic-a4" }),
      }),
    ))
  })

  it("debounces source canvas autosave and announces success", async () => {
    renderPage()
    await screen.findByText("Original canvas text")
    vi.useFakeTimers()

    try {
      fireEvent.click(screen.getByRole("button", { name: "编辑画布" }))

      await act(async () => {
        await vi.advanceTimersByTimeAsync(600)
      })

      expect(apiMocks.saveSourceResumeCanvas).toHaveBeenCalledWith(
        "doc_1",
        expect.objectContaining({ type: "doc" }),
      )
      expect(screen.getByText("已保存")).toBeInTheDocument()
      expect(screen.getByText("Updated canvas text")).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})
