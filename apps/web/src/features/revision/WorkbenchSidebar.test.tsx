import "@testing-library/jest-dom/vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
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

describe("WorkbenchSidebar", () => {
  beforeEach(() => {
    Object.values(apiMocks).forEach((mock) => mock.mockReset())
    Object.values(agentHostMocks).forEach((mock) => mock.mockReset())
    apiMocks.listContextSources.mockResolvedValue([])
    agentHostMocks.listWorkspaceConversations.mockResolvedValue([])
  })

  it("does not render provider-specific defaults in AI settings", async () => {
    render(
      <WorkbenchSidebar
        workspaceId="doc_1"
        title="旧简历重构1"
        onSelectConversation={() => {}}
        onContextSourcesChange={() => {}}
      />,
    )

    await waitFor(() => expect(apiMocks.listContextSources).toHaveBeenCalledWith("doc_1"))
    fireEvent.click(screen.getByRole("button", { name: "设置" }))

    expect(await screen.findByText("AI 设置")).toBeInTheDocument()
    expect(screen.getByPlaceholderText("Provider")).toHaveValue("")
    expect(screen.getByPlaceholderText("Base URL")).toHaveValue("")
    expect(screen.queryByDisplayValue("DeepSeek")).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue("https://api.deepseek.com")).not.toBeInTheDocument()
  })
})
