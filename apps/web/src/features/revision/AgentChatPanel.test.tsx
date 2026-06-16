import "@testing-library/jest-dom/vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AgentMessage } from "@typedance/contracts"
import { AgentChatPanel } from "./AgentChatPanel"

const agentHostMocks = vi.hoisted(() => ({
  cancelAgentRun: vi.fn(),
  createWorkspaceConversation: vi.fn(),
  createAgentRunEventSource: vi.fn(),
  listAgentRunEvents: vi.fn(),
  listConversationMessages: vi.fn(),
  startConversationRun: vi.fn(),
}))

vi.mock("@assistant-ui/react", () => ({
  AssistantRuntimeProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useLocalRuntime: () => ({}),
}))

vi.mock("@/agentHost", () => ({
  cancelAgentRun: (...args: unknown[]) => agentHostMocks.cancelAgentRun(...args),
  createWorkspaceConversation: (...args: unknown[]) => agentHostMocks.createWorkspaceConversation(...args),
  createAgentRunEventSource: (...args: unknown[]) => agentHostMocks.createAgentRunEventSource(...args),
  listAgentRunEvents: (...args: unknown[]) => agentHostMocks.listAgentRunEvents(...args),
  listConversationMessages: (...args: unknown[]) => agentHostMocks.listConversationMessages(...args),
  startConversationRun: (...args: unknown[]) => agentHostMocks.startConversationRun(...args),
}))

function assistantMessage(content: string): AgentMessage {
  return {
    id: "msg_assistant",
    conversation_id: "conv_1",
    role: "assistant",
    content,
    mentions: [],
    created_at: "2026-06-16T08:00:00.000Z",
  }
}

function userMessage(content: string): AgentMessage {
  return {
    id: "msg_user",
    conversation_id: "conv_new",
    role: "user",
    content,
    mentions: [],
    created_at: "2026-06-16T08:00:00.000Z",
  }
}

function eventSourceStub(): EventSource {
  return {
    addEventListener: vi.fn(),
    close: vi.fn(),
  } as unknown as EventSource
}

describe("AgentChatPanel", () => {
  beforeEach(() => {
    Object.values(agentHostMocks).forEach((mock) => mock.mockReset())
    agentHostMocks.listAgentRunEvents.mockResolvedValue([])
    agentHostMocks.createAgentRunEventSource.mockReturnValue(eventSourceStub())
  })

  it("renders assistant GitHub-flavored Markdown tables as tables", async () => {
    agentHostMocks.listConversationMessages.mockResolvedValue([
      assistantMessage([
        "⚠️ 待改进点（按严重程度排序）",
        "",
        "| 问题 | 建议 |",
        "| ---- | ---- |",
        "| 缺乏作品集 | 补充 GitHub / 个人博客链接 |",
      ].join("\n")),
    ])

    render(
      <AgentChatPanel
        workspaceId="doc_1"
        activeConversationId="conv_1"
        contextSources={[]}
        onConversationCreated={() => {}}
      />,
    )

    const table = await screen.findByRole("table")
    const headers = within(table).getAllByRole("columnheader").map((header) => header.textContent)
    const cells = within(table).getAllByRole("cell").map((cell) => cell.textContent)

    expect(headers).toEqual(["问题", "建议"])
    expect(cells).toEqual(["缺乏作品集", "补充 GitHub / 个人博客链接"])
    await waitFor(() => expect(agentHostMocks.listConversationMessages).toHaveBeenCalledWith("conv_1"))
  })

  it("loads the newly created conversation after sending the first prompt", async () => {
    agentHostMocks.createWorkspaceConversation.mockResolvedValue({
      id: "conv_new",
      workspace_id: "doc_1",
      title: "新对话",
      pinned: false,
      status: "idle",
      created_at: "2026-06-16T08:00:00.000Z",
      updated_at: "2026-06-16T08:00:00.000Z",
    })
    agentHostMocks.startConversationRun.mockResolvedValue({
      id: "run_1",
      conversation_id: "conv_new",
      assistant_message_id: "msg_assistant",
      status: "running",
      model: "deepseek-v4-flash",
      mutation_mode: "review",
      started_at: "2026-06-16T08:00:00.000Z",
    })
    agentHostMocks.listConversationMessages.mockImplementation(async (conversationId: string) => (
      conversationId === "conv_new"
        ? [userMessage("检查这份简历质量"), assistantMessage("")]
        : []
    ))

    render(
      <AgentChatPanel
        workspaceId="doc_1"
        activeConversationId={undefined}
        contextSources={[]}
        onConversationCreated={() => {}}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "检查这份简历质量" }))
    fireEvent.keyDown(screen.getByLabelText("AI 输入"), { key: "Enter" })

    await waitFor(() => expect(agentHostMocks.startConversationRun).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(agentHostMocks.listConversationMessages).toHaveBeenCalledWith("conv_new"))
    expect(screen.getByText("检查这份简历质量")).toBeInTheDocument()
    expect(agentHostMocks.startConversationRun).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: "conv_new",
      context: { document_id: "doc_1" },
    }))
  })
})
