import "@testing-library/jest-dom/vitest"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { useState, type ReactNode } from "react"
import { MemoryRouter, Outlet, Route, Routes, useNavigate } from "react-router-dom"
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
  const navigate = useNavigate()
  const [assistantPanelVisible, setAssistantPanelVisible] = useState(assistantVisible)
  const [workbenchSidebarVisible, setWorkbenchSidebarVisible] = useState(sidebarVisible)

  return (
    <>
      <button type="button" onClick={() => navigate("/packs/resume/workspaces/doc_2")}>切换工作区</button>
      <Outlet context={{
        assistantPanelVisible,
        setAssistantPanelVisible,
        workbenchSidebarVisible,
        setWorkbenchSidebarVisible,
      }} />
    </>
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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

async function openWorkspaceRenameDialog() {
  const titlebar = await screen.findByTestId("revision-workspace-titlebar")
  fireEvent.click(within(titlebar).getByRole("button", { name: "重命名工作区" }))
  return screen.getByRole("dialog", { name: "重命名工作区" })
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
    localStorage.clear()
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
    const draftPanel = await screen.findByTestId("revision-draft-panel")
    expect(draftPanel).toHaveClass("overflow-x-auto", "overflow-y-hidden", "overscroll-x-contain")
    expect(draftPanel).not.toHaveClass("overflow-hidden")
    expect(screen.getAllByText("旧简历重构1")).toHaveLength(1)
    expect(screen.queryByText("工作区")).not.toBeInTheDocument()
    expect(screen.queryByTestId("revision-workspace-header")).not.toBeInTheDocument()
    expect(screen.getByText("上下文")).toBeInTheDocument()
    expect(screen.getByText("对话")).toBeInTheDocument()
    expect(screen.queryByText("未选择对话")).not.toBeInTheDocument()
    expect(screen.queryByText("AI 助手")).not.toBeInTheDocument()
    expect(screen.getByText("Original canvas text")).toBeInTheDocument()
    expect(screen.queryByTestId("revision-review-panel")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "质量检查" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "岗位校准" })).not.toBeInTheDocument()
    const workspaceGrid = screen.getByTestId("revision-workspace-grid")
    expect(workspaceGrid).toHaveStyle({
      gridTemplateColumns: "minmax(0, 1fr) 0px 384px",
    })
    expect(screen.getByRole("separator", { name: "调整左侧面板宽度" })).toHaveAttribute("aria-valuenow", "272")
    expect(screen.getByRole("separator", { name: "调整 AI 面板宽度" })).toHaveAttribute("aria-valuenow", "384")
    expect(workspaceGrid).toHaveClass(
      "mr-1",
      "mb-1",
      "rounded-xl",
      "border",
      "border-border",
    )
    expect(workspaceGrid).not.toHaveClass("rounded-l-xl")

    await waitFor(() => expect(apiMocks.listContextSources).toHaveBeenCalledWith("doc_1"))
    await waitFor(() => expect(agentHostMocks.listWorkspaceConversations).toHaveBeenCalledWith("doc_1"))
  })

  it("hides and restores the assistant panel from workbench controls", async () => {
    renderPage()

    const workspaceGrid = await screen.findByTestId("revision-workspace-grid")
    const titlebar = screen.getByTestId("revision-workspace-titlebar")
    const titlebarActions = within(titlebar).getByTestId("revision-workspace-actions")
    expect(within(titlebarActions).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual(["导出"])
    expect(within(titlebar).queryByRole("button", { name: "显示 AI 面板" })).not.toBeInTheDocument()

    const hideAssistantButton = await screen.findByRole("button", { name: "隐藏 AI 面板" })
    expect(hideAssistantButton.querySelector('[data-icon-name="panel-right"]')).toBeInTheDocument()
    fireEvent.click(hideAssistantButton)
    expect(workspaceGrid).toHaveStyle({
      gridTemplateColumns: "minmax(0, 1fr)",
    })
    expect(screen.queryByRole("separator", { name: "调整 AI 面板宽度" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "隐藏 AI 面板" })).not.toBeInTheDocument()

    const toolbar = screen.getByRole("toolbar", { name: "简历格式工具栏" })
    expect(within(toolbar).queryByRole("button", { name: "显示 AI 面板" })).not.toBeInTheDocument()
    expect(within(toolbar).queryByRole("button", { name: "导出" })).not.toBeInTheDocument()
    expect(within(titlebarActions).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "导出",
      "显示 AI 面板",
    ])
    const showAssistantButton = within(titlebarActions).getByRole("button", { name: "显示 AI 面板" })
    expect(showAssistantButton.querySelector('[data-icon-name="panel-right"]')).toBeInTheDocument()
    fireEvent.click(showAssistantButton)
    expect(await screen.findByRole("button", { name: "隐藏 AI 面板" })).toBeInTheDocument()
    expect(workspaceGrid).toHaveStyle({
      gridTemplateColumns: "minmax(0, 1fr) 0px 384px",
    })
  })

  it("expands the assistant panel when selecting a conversation", async () => {
    renderPage(false)

    const workspaceGrid = await screen.findByTestId("revision-workspace-grid")
    fireEvent.click(await screen.findByRole("button", { name: "优化简历" }))

    expect(await screen.findByRole("button", { name: "隐藏 AI 面板" })).toBeInTheDocument()
    expect(workspaceGrid).toHaveStyle({
      gridTemplateColumns: "minmax(0, 1fr) 0px 384px",
    })
    expect(screen.getAllByText("优化简历")).toHaveLength(2)
  })

  it("restores persisted panel widths and keeps them after hiding the assistant", async () => {
    localStorage.setItem(
      "typedance.revision-workspace.panel-widths.v1",
      JSON.stringify({ left: 320, right: 460 }),
    )
    renderPage()

    const workspaceGrid = await screen.findByTestId("revision-workspace-grid")
    expect(screen.getByRole("separator", { name: "调整左侧面板宽度" })).toHaveAttribute("aria-valuenow", "320")
    expect(screen.getByRole("separator", { name: "调整 AI 面板宽度" })).toHaveAttribute("aria-valuenow", "460")
    expect(workspaceGrid).toHaveStyle({
      gridTemplateColumns: "minmax(0, 1fr) 0px 460px",
    })

    fireEvent.click(screen.getByRole("button", { name: "隐藏 AI 面板" }))
    expect(screen.queryByRole("separator", { name: "调整 AI 面板宽度" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "显示 AI 面板" }))
    expect(screen.getByRole("separator", { name: "调整 AI 面板宽度" })).toHaveAttribute("aria-valuenow", "460")
  })

  it("persists keyboard panel width adjustments", async () => {
    renderPage()

    const workspaceGrid = await screen.findByTestId("revision-workspace-grid")
    fireEvent.keyDown(screen.getByRole("separator", { name: "调整左侧面板宽度" }), { key: "ArrowRight" })
    expect(screen.getByRole("separator", { name: "调整左侧面板宽度" })).toHaveAttribute("aria-valuenow", "288")
    expect(JSON.parse(localStorage.getItem("typedance.revision-workspace.panel-widths.v1")!)).toEqual({
      left: 288,
      right: 384,
    })

    fireEvent.keyDown(screen.getByRole("separator", { name: "调整 AI 面板宽度" }), {
      key: "ArrowLeft",
      shiftKey: true,
    })
    expect(workspaceGrid).toHaveStyle({
      gridTemplateColumns: "minmax(0, 1fr) 0px 432px",
    })
    expect(JSON.parse(localStorage.getItem("typedance.revision-workspace.panel-widths.v1")!)).toEqual({
      left: 288,
      right: 432,
    })
  })

  it("updates and renames the active conversation from the AI panel header", async () => {
    renderPage()

    fireEvent.click(await screen.findByRole("button", { name: "优化简历" }))
    fireEvent.keyDown(await screen.findByRole("button", { name: "对话操作" }), { key: "Enter" })
    fireEvent.click(await screen.findByRole("menuitem", { name: "置顶对话" }))

    await waitFor(() => expect(agentHostMocks.updateWorkspaceConversation).toHaveBeenCalledWith("conv_1", { pinned: true }))

    fireEvent.keyDown(screen.getByRole("button", { name: "对话操作" }), { key: "Enter" })
    fireEvent.click(await screen.findByRole("menuitem", { name: "重命名对话" }))
    const dialog = await screen.findByRole("dialog", { name: "重命名对话" })
    fireEvent.change(within(dialog).getByLabelText("对话名称"), { target: { value: "重点优化" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }))

    await waitFor(() => expect(agentHostMocks.updateWorkspaceConversation).toHaveBeenCalledWith("conv_1", { name: "重点优化" }))
    await waitFor(() => expect(agentHostMocks.listWorkspaceConversations.mock.calls.length).toBeGreaterThanOrEqual(3))
  })

  it("removes the workbench sidebar when the global shell hides the left navigation", async () => {
    renderPage(true, false)

    expect(await screen.findByTestId("revision-draft-panel")).toBeInTheDocument()
    expect(screen.queryByText("上下文")).not.toBeInTheDocument()
    expect(screen.queryByRole("separator", { name: "调整左侧面板宽度" })).not.toBeInTheDocument()
  })

  it("lazily expands local directory context sources", async () => {
    renderPage()

    const materials = await screen.findByRole("button", { name: "materials" })
    fireEvent.click(materials)

    await waitFor(() => expect(apiMocks.listContextSourceChildren).toHaveBeenCalledWith("ctx_dir"))
    expect(await screen.findByText("jd.md")).toBeInTheDocument()
  })

  it("starts an untitled local draft without creating a conversation", async () => {
    renderPage()

    fireEvent.click(await screen.findByRole("button", { name: "优化简历" }))
    expect(screen.getAllByText("优化简历")).toHaveLength(2)
    fireEvent.click((await screen.findAllByRole("button", { name: "新对话" }))[0])

    expect(agentHostMocks.createWorkspaceConversation).not.toHaveBeenCalled()
    expect(agentHostMocks.listWorkspaceConversations).toHaveBeenCalledTimes(1)
    expect(screen.getAllByText("优化简历")).toHaveLength(1)
    expect(screen.queryByRole("button", { name: "对话操作" })).not.toBeInTheDocument()
  })

  it("clears the active conversation when the selected conversation is deleted", async () => {
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

    fireEvent.keyDown(screen.getByRole("button", { name: "Optimize resume操作" }), { key: "Enter" })
    fireEvent.click(await screen.findByRole("menuitem", { name: "删除对话" }))
    const confirmation = await screen.findByRole("alertdialog")
    fireEvent.click(within(confirmation).getByRole("button", { name: "删除" }))

    await waitFor(() => expect(agentHostMocks.deleteWorkspaceConversation).toHaveBeenCalledWith("conv_1"))
    await waitFor(() => expect(screen.queryByText("Assistant answer")).not.toBeInTheDocument())
    expect(screen.queryByText("未选择对话")).not.toBeInTheDocument()
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

    fireEvent.click((await screen.findAllByRole("button", { name: "新对话" }))[0])
    const composer = screen.getByRole("textbox")
    typeComposerText(composer, "Check title refresh")
    fireEvent.keyDown(composer, { key: "Enter" })

    await waitFor(() => expect(agentHostMocks.createAgentRunEventSource).toHaveBeenCalledWith("run_1"))
    await waitFor(() => expect(agentHostMocks.listWorkspaceConversations.mock.calls.length).toBeGreaterThanOrEqual(2))
    const refreshedConversation = await screen.findByRole("button", { name: "Check title refresh" })
    expect(refreshedConversation).toHaveClass("truncate")
  })

  it("closes the dialog and updates the title after a successful rename", async () => {
    const request = deferred<WorkspaceView["document"]>()
    apiMocks.updateRevisionDocument.mockReturnValue(request.promise)
    renderPage()

    const titlebar = await screen.findByTestId("revision-workspace-titlebar")
    expect(titlebar).not.toHaveClass("rounded-l-xl")
    expect(screen.getByTestId("revision-workspace-grid")).not.toHaveClass("rounded-l-xl", "border", "border-border")
    expect(within(titlebar).getByText("旧简历重构1")).toBeInTheDocument()
    expect(within(titlebar).getByRole("button", { name: "重命名工作区" })).toBeInTheDocument()
    expect(within(titlebar).queryByRole("button", { name: "工作区操作" })).not.toBeInTheDocument()

    const sidebar = screen.getAllByRole("button", { name: "新对话" })[0].closest("aside")
    expect(sidebar).not.toBeNull()
    if (!sidebar) throw new Error("Workbench sidebar is missing")
    expect(within(sidebar).queryByText("旧简历重构1")).not.toBeInTheDocument()
    expect(within(sidebar).queryByRole("button", { name: "工作区操作" })).not.toBeInTheDocument()

    await openWorkspaceRenameDialog()
    const titleInput = screen.getByLabelText("工作区标题")
    expect(screen.getByText("6/10")).toBeInTheDocument()
    fireEvent.change(titleInput, { target: { value: "一二三四五六七八九十十一" } })
    expect(titleInput).toHaveValue("一二三四五六七八九十")
    expect(screen.getByText("10/10")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "保存" }))
    expect(apiMocks.updateRevisionDocument).toHaveBeenCalledWith("doc_1", { title: "一二三四五六七八九十" })

    await act(async () => {
      request.resolve({ ...workspace.document, title: "一二三四五六七八九十" })
    })

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "重命名工作区" })).not.toBeInTheDocument())
    expect(within(titlebar).getByText("一二三四五六七八九十")).toBeInTheDocument()
  })

  it("keeps the dialog open and exposes an accessible error after rename failure", async () => {
    const request = deferred<WorkspaceView["document"]>()
    apiMocks.updateRevisionDocument.mockReturnValue(request.promise)
    renderPage()

    const dialog = await openWorkspaceRenameDialog()
    const titleInput = within(dialog).getByLabelText("工作区标题")
    fireEvent.change(titleInput, { target: { value: "新标题" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }))

    await act(async () => {
      request.reject(new Error("save failed"))
    })

    const error = await within(dialog).findByRole("alert")
    expect(error).toHaveTextContent("标题保存失败，请稍后重试。")
    expect(error).toHaveAttribute("id", "workspace-title-error")
    expect(titleInput).toHaveAttribute("aria-invalid", "true")
    expect(titleInput).toHaveAttribute("aria-errormessage", "workspace-title-error")
    expect(screen.getByRole("dialog", { name: "重命名工作区" })).toBeInTheDocument()
  })

  it("cancels the rename dialog and clears the previous error", async () => {
    const request = deferred<WorkspaceView["document"]>()
    apiMocks.updateRevisionDocument.mockReturnValue(request.promise)
    renderPage()

    let dialog = await openWorkspaceRenameDialog()
    fireEvent.change(within(dialog).getByLabelText("工作区标题"), { target: { value: "新标题" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }))
    await act(async () => {
      request.reject(new Error("save failed"))
    })
    expect(await within(dialog).findByRole("alert")).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "重命名工作区" })).not.toBeInTheDocument())

    dialog = await openWorkspaceRenameDialog()
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument()
    expect(within(dialog).getByLabelText("工作区标题")).toHaveValue("旧简历重构1")
  })

  it("submits a pending rename only once and prevents every dismiss path", async () => {
    const request = deferred<WorkspaceView["document"]>()
    apiMocks.updateRevisionDocument.mockReturnValue(request.promise)
    renderPage()

    const dialog = await openWorkspaceRenameDialog()
    const titleInput = within(dialog).getByLabelText("工作区标题")
    fireEvent.change(titleInput, { target: { value: "新标题" } })
    fireEvent.keyDown(titleInput, { key: "Enter" })
    fireEvent.submit(titleInput.closest("form")!)
    fireEvent.submit(titleInput.closest("form")!)

    expect(apiMocks.updateRevisionDocument).toHaveBeenCalledTimes(1)
    expect(within(dialog).queryByRole("button", { name: "Close" })).not.toBeInTheDocument()
    fireEvent.keyDown(document, { key: "Escape" })
    fireEvent.pointerDown(document.body)
    expect(screen.getByRole("dialog", { name: "重命名工作区" })).toBeInTheDocument()

    await act(async () => {
      request.resolve({ ...workspace.document, title: "新标题" })
    })
  })

  it.each(["resolve", "reject"] as const)("ignores a stale rename %s after switching workspaces", async (outcome) => {
    const request = deferred<WorkspaceView["document"]>()
    const nextWorkspace: WorkspaceView = {
      ...workspace,
      document: { ...workspace.document, id: "doc_2", title: "第二工作区" },
      current_draft: workspace.current_draft ? { ...workspace.current_draft, id: "draft_2", document_id: "doc_2" } : undefined,
      source_resume_canvas: workspace.source_resume_canvas
        ? { ...workspace.source_resume_canvas, id: "canvas_2", document_id: "doc_2" }
        : undefined,
    }
    apiMocks.getRevisionWorkspaceView.mockImplementation(async (documentId: string) => (
      documentId === "doc_2" ? nextWorkspace : workspace
    ))
    apiMocks.updateRevisionDocument.mockReturnValue(request.promise)
    renderPage()

    const dialog = await openWorkspaceRenameDialog()
    fireEvent.change(within(dialog).getByLabelText("工作区标题"), { target: { value: "过期标题" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }))
    fireEvent.click(screen.getByText("切换工作区"))

    const nextTitlebar = await screen.findByTestId("revision-workspace-titlebar")
    await waitFor(() => expect(within(nextTitlebar).getByText("第二工作区")).toBeInTheDocument())
    expect(screen.queryByRole("dialog", { name: "重命名工作区" })).not.toBeInTheDocument()

    await act(async () => {
      if (outcome === "resolve") {
        request.resolve({ ...workspace.document, title: "过期标题" })
      } else {
        request.reject(new Error("stale failure"))
      }
    })

    expect(within(nextTitlebar).getByText("第二工作区")).toBeInTheDocument()
    expect(screen.queryByRole("dialog", { name: "重命名工作区" })).not.toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("does not keep a duplicate return action in the workbench sidebar", async () => {
    renderPage()

    expect(await screen.findByTestId("revision-draft-panel")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "返回工作区列表" })).not.toBeInTheDocument()
  })

  it("exports PDF and HTML from the workspace titlebar with current canvas and page margins", async () => {
    renderPage()

    fireEvent.click(await screen.findByRole("button", { name: "调整页边距" }))
    const toolbar = await screen.findByRole("toolbar", { name: "简历格式工具栏" })
    const titlebar = screen.getByTestId("revision-workspace-titlebar")
    const exportButton = within(titlebar).getByRole("button", { name: "导出" })
    expect(within(toolbar).queryByRole("button", { name: "导出" })).not.toBeInTheDocument()
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

    fireEvent.keyDown(exportButton, { key: "ArrowDown" })
    fireEvent.click(await screen.findByRole("menuitem", { name: "导出 HTML" }))
    await waitFor(() => expect(apiMocks.exportRevisionDocumentHtml).toHaveBeenCalledWith(
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
