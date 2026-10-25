import "@testing-library/jest-dom/vitest"
import { act, fireEvent, render as renderBase, screen, waitFor, within } from "@testing-library/react"
import type { ReactElement } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { WorkbenchSidebar } from "./WorkbenchSidebar"
import { WorkspaceConversationsProvider } from "./WorkspaceConversations"

function render(element: ReactElement) {
  return renderBase(<WorkspaceConversationsProvider workspaceId="doc_1">{element}</WorkspaceConversationsProvider>)
}

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
  clearModelApiKey: vi.fn(),
  createWorkspaceConversation: vi.fn(),
  deleteWorkspaceConversation: vi.fn(),
  getModelSettings: vi.fn(),
  listWorkspaceConversations: vi.fn(),
  listWorkspacePlugins: vi.fn(),
  updateModelSettings: vi.fn(),
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
  clearModelApiKey: (...args: unknown[]) => agentHostMocks.clearModelApiKey(...args),
  createWorkspaceConversation: (...args: unknown[]) => agentHostMocks.createWorkspaceConversation(...args),
  deleteWorkspaceConversation: (...args: unknown[]) => agentHostMocks.deleteWorkspaceConversation(...args),
  getModelSettings: (...args: unknown[]) => agentHostMocks.getModelSettings(...args),
  listWorkspaceConversations: (...args: unknown[]) => agentHostMocks.listWorkspaceConversations(...args),
  listWorkspacePlugins: (...args: unknown[]) => agentHostMocks.listWorkspacePlugins(...args),
  updateModelSettings: (...args: unknown[]) => agentHostMocks.updateModelSettings(...args),
  updateWorkspaceConversation: (...args: unknown[]) => agentHostMocks.updateWorkspaceConversation(...args),
}))

vi.mock("@/tauri", () => ({
  chooseContextDirectoryPathInTauri: vi.fn(),
  chooseContextFilePathsInTauri: vi.fn(),
  isTauri: () => false,
}))

describe("WorkbenchSidebar", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} })
    Object.values(apiMocks).forEach((mock) => mock.mockReset())
    Object.values(agentHostMocks).forEach((mock) => mock.mockReset())
    apiMocks.listContextSources.mockResolvedValue([])
    agentHostMocks.listWorkspaceConversations.mockResolvedValue([])
    agentHostMocks.getModelSettings.mockResolvedValue({
      provider: "deepseek",
      model: "deepseek-v4-flash",
      base_url: "https://api.deepseek.com",
      api_key: { configured: false, preview: null },
    })
  })

  it("recovers the workspace conversation list after an initial network failure", async () => {
    agentHostMocks.listWorkspaceConversations.mockRejectedValueOnce(new Error("network failure"))
    render(<TooltipProvider><WorkbenchSidebar workspaceId="doc_1" onSelectConversation={() => {}} onStartNewConversation={() => {}} onContextSourcesChange={() => {}} /></TooltipProvider>)
    await waitFor(() => expect(agentHostMocks.listWorkspaceConversations).toHaveBeenCalledTimes(2), { timeout: 3500 })
    expect(await screen.findByText("还没有对话。")).toBeInTheDocument()
  })

  it("loads AI settings from Agent Host instead of hardcoded frontend defaults", async () => {
    render(
      <TooltipProvider>
        <WorkbenchSidebar
          workspaceId="doc_1"
          onSelectConversation={() => {}}
          onStartNewConversation={() => {}}
          onContextSourcesChange={() => {}}
        />
      </TooltipProvider>,
    )

    await waitFor(() => expect(apiMocks.listContextSources).toHaveBeenCalledWith("doc_1"))
    fireEvent.click(screen.getByRole("button", { name: "设置" }))

    expect(await screen.findByRole("heading", { name: "AI 设置" })).toBeInTheDocument()
    expect(await screen.findByDisplayValue("deepseek-v4-flash")).toBeInTheDocument()
    expect(screen.getByDisplayValue("https://api.deepseek.com")).toBeInTheDocument()
    expect(agentHostMocks.getModelSettings).toHaveBeenCalledTimes(1)
  })

  it("starts with primary actions and omits workspace title controls", async () => {
    render(
      <TooltipProvider>
        <WorkbenchSidebar
          workspaceId="doc_1"
          onSelectConversation={() => {}}
          onStartNewConversation={() => {}}
          onContextSourcesChange={() => {}}
        />
      </TooltipProvider>,
    )

    await waitFor(() => expect(apiMocks.listContextSources).toHaveBeenCalledWith("doc_1"))
    await waitFor(() => expect(agentHostMocks.listWorkspaceConversations).toHaveBeenCalledWith("doc_1", expect.any(AbortSignal)))
    await waitFor(() => expect(screen.queryByText("加载资料")).not.toBeInTheDocument())
    await screen.findByText("还没有对话。")

    expect(screen.getAllByRole("button", { name: "新对话" })).toHaveLength(2)
    expect(screen.queryByText("旧简历重构1")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "工作区操作" })).not.toBeInTheDocument()
    expect(screen.queryByTestId("revision-workspace-title-button")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "返回工作区列表" })).not.toBeInTheDocument()
    const sidebar = screen.getAllByRole("button", { name: "新对话" })[0].closest("aside")
    expect(sidebar).not.toHaveClass("border-y", "border-t", "border-b")
    expect(sidebar).not.toHaveClass("border-r")
    expect(screen.getByRole("button", { name: "设置" }).parentElement).not.toHaveClass("border-t")
  })

  it("starts a local draft from both conversation actions without creating a conversation", async () => {
    const onSelectConversation = vi.fn()
    const onStartNewConversation = vi.fn()

    render(
      <TooltipProvider>
        <WorkbenchSidebar
          workspaceId="doc_1"
          onSelectConversation={onSelectConversation}
          onStartNewConversation={onStartNewConversation}
          onContextSourcesChange={() => {}}
        />
      </TooltipProvider>,
    )

    await waitFor(() => expect(agentHostMocks.listWorkspaceConversations).toHaveBeenCalledWith("doc_1", expect.any(AbortSignal)))
    await waitFor(() => expect(screen.queryByText("加载资料")).not.toBeInTheDocument())
    await screen.findByText("还没有对话。")

    const createButtons = screen.getAllByRole("button", { name: "新对话" })
    expect(createButtons).toHaveLength(2)
    expect(createButtons[0].querySelector('[data-icon-name="new-conversation"]')).toBeInTheDocument()
    expect(createButtons[1].querySelector('[data-icon-name="new-conversation"]')).toBeInTheDocument()
    expect(createButtons[1]).toHaveClass(
      "pointer-events-none",
      "opacity-0",
      "group-hover:pointer-events-auto",
      "group-hover:opacity-100",
      "group-focus-within:pointer-events-auto",
      "group-focus-within:opacity-100",
    )

    const conversationHeading = screen.getByText("对话").parentElement
    expect(conversationHeading).toHaveClass("group")

    fireEvent.click(createButtons[0])
    fireEvent.click(screen.getAllByRole("button", { name: "新对话" })[1])
    expect(onStartNewConversation).toHaveBeenCalledTimes(2)
    expect(onSelectConversation).not.toHaveBeenCalled()
    expect(agentHostMocks.createWorkspaceConversation).not.toHaveBeenCalled()

    const pluginButton = screen.getByRole("button", { name: "插件" })
    expect(pluginButton.querySelector('[data-icon-name="plugin-grid"]')).toBeInTheDocument()
    expect(pluginButton.querySelectorAll('[data-icon-name="plugin-grid"] circle')).toHaveLength(4)
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
          workspaceId="doc_1"
          onSelectConversation={() => {}}
          onStartNewConversation={() => {}}
          onContextSourcesChange={() => {}}
        />
      </TooltipProvider>,
    )

    const namedRow = await screen.findByRole("button", { name: "查明提示词管理方式" })
    const previewRow = await screen.findByRole("button", { name: longPreview })
    expect(namedRow.querySelector("[data-hover-scroll-text]")).toBeInTheDocument()
    expect(namedRow).toHaveAttribute("aria-label", "查明提示词管理方式")
    expect(previewRow.querySelector("[data-hover-scroll-text]")).toBeInTheDocument()
    expect(previewRow).toHaveAttribute("aria-label", longPreview)
  })

  it("updates every conversation time while tasks run without fetching or clicking again", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-25T08:01:00Z"))
    agentHostMocks.listWorkspaceConversations.mockResolvedValue(["a", "b"].map((id) => ({
      id, workspace_id: "doc_1", name: `对话 ${id}`, preview: "", pinned: false, status: "running",
      created_at: "2026-10-25T08:00:00Z", updated_at: "2026-10-25T08:00:00Z", last_message_at: "2026-10-25T08:00:00Z",
    })))
    let view: ReturnType<typeof render> | undefined
    try {
      await act(async () => {
        view = render(<TooltipProvider><WorkbenchSidebar workspaceId="doc_1" onSelectConversation={() => {}} onStartNewConversation={() => {}} onContextSourcesChange={() => {}} /></TooltipProvider>)
      })
      expect(screen.getAllByTestId("conversation-time").map((time) => time.textContent)).toEqual(["1 分", "1 分"])
      await act(async () => { vi.advanceTimersByTime(60_000) })
      expect(screen.getAllByTestId("conversation-time").map((time) => time.textContent)).toEqual(["2 分", "2 分"])
      expect(agentHostMocks.listWorkspaceConversations).toHaveBeenCalledOnce()
      view!.unmount()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      view?.unmount()
      vi.useRealTimers()
    }
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
          workspaceId="doc_1"
          onSelectConversation={() => {}}
          onStartNewConversation={() => {}}
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

  it("does not render an empty server-side conversation as 新对话", async () => {
    agentHostMocks.listWorkspaceConversations.mockResolvedValue([{
      id: "conv_empty",
      workspace_id: "doc_1",
      name: null,
      preview: "",
      pinned: false,
      status: "idle",
      created_at: "2026-06-18T08:00:00.000Z",
      updated_at: "2026-06-18T08:00:00.000Z",
    }])

    render(
      <TooltipProvider>
        <WorkbenchSidebar
          workspaceId="doc_1"
          onSelectConversation={() => {}}
          onStartNewConversation={() => {}}
          onContextSourcesChange={() => {}}
        />
      </TooltipProvider>,
    )

    await waitFor(() => expect(agentHostMocks.listWorkspaceConversations).toHaveBeenCalledWith("doc_1", expect.any(AbortSignal)))
    expect(document.querySelector("[data-conversation-row]")).not.toBeInTheDocument()
    expect(screen.getByText("还没有对话。")).toBeInTheDocument()
  })

  it("shows the conversation menu before rename and confirms deletion", async () => {
    agentHostMocks.listWorkspaceConversations.mockResolvedValue([
      {
        id: "conv_1",
        workspace_id: "doc_1",
        name: "质量检查",
        preview: "检查这份简历质量",
        pinned: false,
        status: "idle",
        created_at: "2026-06-16T08:00:00.000Z",
        updated_at: "2026-06-16T08:00:00.000Z",
      },
    ])
    agentHostMocks.deleteWorkspaceConversation.mockResolvedValue(undefined)

    render(
      <TooltipProvider>
        <WorkbenchSidebar
          workspaceId="doc_1"
          onSelectConversation={() => {}}
          onStartNewConversation={() => {}}
          onContextSourcesChange={() => {}}
        />
      </TooltipProvider>,
    )

    const row = (await screen.findByRole("button", { name: "质量检查" })).closest("[data-conversation-row]") as HTMLElement | null
    expect(row).not.toBeNull()
    expect(within(row!).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "质量检查",
      "质量检查操作",
      "重命名质量检查",
    ])
    expect(within(row!).getByRole("button", { name: "质量检查操作" })).toHaveClass("hidden", "group-hover:inline-flex")
    expect(within(row!).getByRole("button", { name: "重命名质量检查" })).toHaveClass("hidden", "group-hover:inline-flex")
    expect(within(row!).getByTestId("conversation-time")).toHaveClass("ml-auto", "group-hover:hidden")

    fireEvent.keyDown(within(row!).getByRole("button", { name: "质量检查操作" }), { key: "Enter" })
    const pinItem = await screen.findByRole("menuitem", { name: "置顶对话" })
    expect(pinItem.querySelector("svg")).toHaveAttribute("fill", "currentColor")
    fireEvent.click(screen.getByRole("menuitem", { name: "删除对话" }))

    expect(agentHostMocks.deleteWorkspaceConversation).not.toHaveBeenCalled()
    const confirmation = await screen.findByRole("alertdialog")
    expect(confirmation).toHaveTextContent("质量检查")
    fireEvent.click(within(confirmation).getByRole("button", { name: "删除" }))

    await waitFor(() => expect(agentHostMocks.deleteWorkspaceConversation).toHaveBeenCalledWith("conv_1"))
    await waitFor(() => expect(agentHostMocks.listWorkspaceConversations).toHaveBeenCalledTimes(2))
  })

  it("shows cancel pinning for a pinned conversation", async () => {
    agentHostMocks.listWorkspaceConversations.mockResolvedValue([
      {
        id: "conv_1",
        workspace_id: "doc_1",
        name: "已置顶对话",
        preview: "",
        pinned: true,
        status: "idle",
        last_message_at: "2026-06-18T08:00:00.000Z",
        created_at: "2026-06-16T08:00:00.000Z",
        updated_at: "2026-06-16T08:00:00.000Z",
      },
    ])

    render(
      <TooltipProvider>
        <WorkbenchSidebar
          workspaceId="doc_1"
          onSelectConversation={() => {}}
          onStartNewConversation={() => {}}
          onContextSourcesChange={() => {}}
        />
      </TooltipProvider>,
    )

    const row = (await screen.findByRole("button", { name: "已置顶对话" })).closest("[data-conversation-row]")
    expect(row).not.toBeNull()
    expect(row!.querySelector('[data-pinned="true"]')).toHaveAttribute("fill", "currentColor")
    expect(row!.querySelector('[data-pinned="true"]')).toHaveClass("size-3")

    fireEvent.keyDown(screen.getByRole("button", { name: "已置顶对话操作" }), { key: "Enter" })
    const cancelPinItem = await screen.findByRole("menuitem", { name: "取消置顶对话" })
    expect(cancelPinItem.querySelector("svg")).not.toHaveAttribute("fill", "currentColor")
    fireEvent.click(cancelPinItem)

    await waitFor(() => expect(agentHostMocks.updateWorkspaceConversation).toHaveBeenCalledWith("conv_1", { pinned: false }))
  })
})
