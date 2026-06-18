import "@testing-library/jest-dom/vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { WorkbenchSidebar } from "./WorkbenchSidebar"

const apiMocks = vi.hoisted(() => ({
  addDirectoryContextSource: vi.fn(),
  addFileContextSource: vi.fn(),
  addWebpageContextSource: vi.fn(),
  listContextSourceChildren: vi.fn(),
  listContextSources: vi.fn(),
  openContextSource: vi.fn(),
  openContextSourceChild: vi.fn(),
  refreshContextSource: vi.fn(),
  removeContextSource: vi.fn(),
  revealContextSource: vi.fn(),
  revealContextSourceChild: vi.fn(),
  updateContextSourceTitle: vi.fn(),
}))

const agentHostMocks = vi.hoisted(() => ({
  createWorkspaceConversation: vi.fn(),
  deleteWorkspaceConversation: vi.fn(),
  listWorkspaceConversations: vi.fn(),
  listWorkspacePlugins: vi.fn(),
  updateWorkspaceConversation: vi.fn(),
}))

vi.mock("@/api", () => ({
  addDirectoryContextSource: (...args: unknown[]) => apiMocks.addDirectoryContextSource(...args),
  addFileContextSource: (...args: unknown[]) => apiMocks.addFileContextSource(...args),
  addWebpageContextSource: (...args: unknown[]) => apiMocks.addWebpageContextSource(...args),
  listContextSourceChildren: (...args: unknown[]) => apiMocks.listContextSourceChildren(...args),
  listContextSources: (...args: unknown[]) => apiMocks.listContextSources(...args),
  openContextSource: (...args: unknown[]) => apiMocks.openContextSource(...args),
  openContextSourceChild: (...args: unknown[]) => apiMocks.openContextSourceChild(...args),
  refreshContextSource: (...args: unknown[]) => apiMocks.refreshContextSource(...args),
  removeContextSource: (...args: unknown[]) => apiMocks.removeContextSource(...args),
  revealContextSource: (...args: unknown[]) => apiMocks.revealContextSource(...args),
  revealContextSourceChild: (...args: unknown[]) => apiMocks.revealContextSourceChild(...args),
  updateContextSourceTitle: (...args: unknown[]) => apiMocks.updateContextSourceTitle(...args),
}))

vi.mock("@/agentHost", () => ({
  createWorkspaceConversation: (...args: unknown[]) => agentHostMocks.createWorkspaceConversation(...args),
  deleteWorkspaceConversation: (...args: unknown[]) => agentHostMocks.deleteWorkspaceConversation(...args),
  listWorkspaceConversations: (...args: unknown[]) => agentHostMocks.listWorkspaceConversations(...args),
  listWorkspacePlugins: (...args: unknown[]) => agentHostMocks.listWorkspacePlugins(...args),
  updateWorkspaceConversation: (...args: unknown[]) => agentHostMocks.updateWorkspaceConversation(...args),
}))

vi.mock("@/tauri", () => ({
  chooseContextDirectoryPathInTauri: vi.fn(),
  chooseContextFilePathsInTauri: vi.fn(),
  isTauri: () => false,
}))

const titleControlProps = {
  editingTitle: false,
  titleDraft: "旧简历重构1",
  isSavingTitle: false,
  onStartTitleEditing: () => {},
  onTitleDraftChange: () => {},
  onCommitTitleEditing: () => {},
  onCancelTitleEditing: () => {},
  onBack: () => {},
}

describe("WorkbenchSidebar", () => {
  beforeEach(() => {
    Object.values(apiMocks).forEach((mock) => mock.mockReset())
    Object.values(agentHostMocks).forEach((mock) => mock.mockReset())
    apiMocks.listContextSources.mockResolvedValue([])
    agentHostMocks.listWorkspaceConversations.mockResolvedValue([])
  })

  it("does not render provider-specific defaults in AI settings", async () => {
    render(
      <TooltipProvider>
        <WorkbenchSidebar
          {...titleControlProps}
          workspaceId="doc_1"
          title="旧简历重构1"
          onSelectConversation={() => {}}
          onContextSourcesChange={() => {}}
        />
      </TooltipProvider>,
    )

    await waitFor(() => expect(apiMocks.listContextSources).toHaveBeenCalledWith("doc_1"))
    fireEvent.click(screen.getByRole("button", { name: "设置" }))

    expect(await screen.findByText("AI 设置")).toBeInTheDocument()
    expect(screen.getByPlaceholderText("Provider")).toHaveValue("")
    expect(screen.getByPlaceholderText("Base URL")).toHaveValue("")
    expect(screen.queryByDisplayValue("DeepSeek")).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue("https://api.deepseek.com")).not.toBeInTheDocument()
  })

  it("renders controlled workspace title editing and the back action", async () => {
    const onStartTitleEditing = vi.fn()
    const onTitleDraftChange = vi.fn()
    const onCommitTitleEditing = vi.fn()
    const onCancelTitleEditing = vi.fn()
    const onBack = vi.fn()
    const onSelectConversation = vi.fn()
    const onContextSourcesChange = vi.fn()

    const { rerender } = render(
      <TooltipProvider>
        <WorkbenchSidebar
          workspaceId="doc_1"
          title="旧简历重构1"
          editingTitle={false}
          titleDraft="旧简历重构1"
          isSavingTitle={false}
          onStartTitleEditing={onStartTitleEditing}
          onTitleDraftChange={onTitleDraftChange}
          onCommitTitleEditing={onCommitTitleEditing}
          onCancelTitleEditing={onCancelTitleEditing}
          onBack={onBack}
          onSelectConversation={onSelectConversation}
          onContextSourcesChange={onContextSourcesChange}
        />
      </TooltipProvider>,
    )

    await waitFor(() => expect(apiMocks.listContextSources).toHaveBeenCalledWith("doc_1"))
    await waitFor(() => expect(agentHostMocks.listWorkspaceConversations).toHaveBeenCalledWith("doc_1"))
    await waitFor(() => expect(screen.queryByText("加载上下文")).not.toBeInTheDocument())
    await screen.findByText("还没有对话。")

    const titleButton = screen.getByTestId("revision-workspace-title-button")
    expect(titleButton).toHaveAttribute("data-size", "icon-xs")
    expect(titleButton.previousElementSibling).toHaveTextContent("旧简历重构1")
    expect(titleButton.previousElementSibling).not.toHaveClass("flex-1")
    expect(titleButton.parentElement).toHaveClass("items-center")
    expect(titleButton.parentElement?.parentElement).toHaveClass("items-center")
    fireEvent.click(titleButton)
    expect(onStartTitleEditing).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole("button", { name: "返回工作区列表" }))
    expect(onBack).toHaveBeenCalledOnce()

    rerender(
      <TooltipProvider>
        <WorkbenchSidebar
          workspaceId="doc_1"
          title="旧简历重构1"
          editingTitle
          titleDraft="一二三"
          isSavingTitle={false}
          onStartTitleEditing={onStartTitleEditing}
          onTitleDraftChange={onTitleDraftChange}
          onCommitTitleEditing={onCommitTitleEditing}
          onCancelTitleEditing={onCancelTitleEditing}
          onBack={onBack}
          onSelectConversation={onSelectConversation}
          onContextSourcesChange={onContextSourcesChange}
        />
      </TooltipProvider>,
    )

    const input = screen.getByLabelText("工作区标题")
    expect(screen.getByText("3/10")).toBeInTheDocument()
    fireEvent.change(input, { target: { value: "一二三四" } })
    expect(onTitleDraftChange).toHaveBeenCalledWith("一二三四")
    fireEvent.keyDown(input, { key: "Escape" })
    expect(onCancelTitleEditing).toHaveBeenCalledOnce()
  })

  it("shows conversation names with preview fallback and truncates long rows", async () => {
    const longPreview = "检查这份简历质量，并指出最影响求职成功率的问题，同时给出优先级"
    agentHostMocks.listWorkspaceConversations.mockResolvedValue([
      {
        id: "conv_named",
        workspace_id: "doc_1",
        name: "查明提示词管理方式",
        preview: longPreview,
        pinned: false,
        status: "idle",
        created_at: "2026-06-16T08:00:00.000Z",
        updated_at: "2026-06-16T08:00:00.000Z",
      },
      {
        id: "conv_preview",
        workspace_id: "doc_1",
        name: null,
        preview: longPreview,
        pinned: false,
        status: "idle",
        created_at: "2026-06-16T08:01:00.000Z",
        updated_at: "2026-06-16T08:01:00.000Z",
      },
    ])

    render(
      <TooltipProvider>
        <WorkbenchSidebar
          {...titleControlProps}
          workspaceId="doc_1"
          title="旧简历重构1"
          onSelectConversation={() => {}}
          onContextSourcesChange={() => {}}
        />
      </TooltipProvider>,
    )

    const namedRow = await screen.findByRole("button", { name: "查明提示词管理方式" })
    const previewRow = await screen.findByRole("button", { name: longPreview })
    expect(namedRow).toHaveClass("truncate")
    expect(namedRow).toHaveAttribute("title", "查明提示词管理方式")
    expect(previewRow).toHaveClass("truncate")
    expect(previewRow).toHaveAttribute("title", longPreview)
  })

  it("renames a conversation from the row context menu", async () => {
    agentHostMocks.listWorkspaceConversations.mockResolvedValue([
      {
        id: "conv_1",
        workspace_id: "doc_1",
        name: null,
        preview: "检查这份简历质量",
        pinned: false,
        status: "idle",
        created_at: "2026-06-16T08:00:00.000Z",
        updated_at: "2026-06-16T08:00:00.000Z",
      },
    ])
    agentHostMocks.updateWorkspaceConversation.mockResolvedValue({
      id: "conv_1",
      workspace_id: "doc_1",
      name: "质量检查",
      preview: "检查这份简历质量",
      pinned: false,
      status: "idle",
      created_at: "2026-06-16T08:00:00.000Z",
      updated_at: "2026-06-16T08:01:00.000Z",
    })

    render(
      <TooltipProvider>
        <WorkbenchSidebar
          {...titleControlProps}
          workspaceId="doc_1"
          title="旧简历重构1"
          onSelectConversation={() => {}}
          onContextSourcesChange={() => {}}
        />
      </TooltipProvider>,
    )

    fireEvent.contextMenu(await screen.findByRole("button", { name: "检查这份简历质量" }))
    expect(await screen.findByText("重命名对话")).toBeInTheDocument()

    const input = screen.getByLabelText("对话名称")
    fireEvent.change(input, { target: { value: "质量检查" } })
    fireEvent.click(screen.getByRole("button", { name: "保存" }))

    await waitFor(() => expect(agentHostMocks.updateWorkspaceConversation).toHaveBeenCalledWith("conv_1", { name: "质量检查" }))
    await waitFor(() => expect(agentHostMocks.listWorkspaceConversations).toHaveBeenCalledTimes(2))
  })
})
