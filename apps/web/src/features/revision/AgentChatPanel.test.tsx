import "@testing-library/jest-dom/vitest"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AgentMessage, ContextSource } from "@typedance/contracts"
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

function assistantMessage(content: string, runId?: string): AgentMessage {
  return {
    id: runId ? `msg_assistant_${runId}` : "msg_assistant",
    conversation_id: "conv_1",
    role: "assistant",
    content,
    mentions: [],
    created_at: "2026-06-16T08:00:00.000Z",
    ...(runId ? { run_id: runId } : {}),
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

function controllableEventSource() {
  const listeners = new Map<string, Array<(event: MessageEvent) => void>>()
  return {
    source: {
      addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
        const current = listeners.get(type) ?? []
        current.push(listener as (event: MessageEvent) => void)
        listeners.set(type, current)
      }),
      close: vi.fn(),
    } as unknown as EventSource,
    dispatch(type: string, payload: Record<string, unknown>) {
      for (const listener of listeners.get(type) ?? []) {
        listener(new MessageEvent(type, { data: JSON.stringify(payload) }))
      }
    },
  }
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

function mockMessageListScroll(
  element: HTMLElement,
  metrics: { clientHeight: number; scrollHeight: number; scrollTop: number },
) {
  Object.defineProperty(element, "clientHeight", { configurable: true, value: metrics.clientHeight })
  Object.defineProperty(element, "scrollHeight", { configurable: true, writable: true, value: metrics.scrollHeight })
  Object.defineProperty(element, "scrollTop", { configurable: true, writable: true, value: metrics.scrollTop })
  const scrollTo = vi.fn()
  Object.defineProperty(element, "scrollTo", { configurable: true, value: scrollTo })

  return {
    scrollTo,
    setScrollHeight(value: number) {
      Object.defineProperty(element, "scrollHeight", { configurable: true, writable: true, value })
    },
  }
}

describe("AgentChatPanel", () => {
  beforeEach(() => {
    Object.values(agentHostMocks).forEach((mock) => mock.mockReset())
    agentHostMocks.listAgentRunEvents.mockResolvedValue([])
    agentHostMocks.createAgentRunEventSource.mockReturnValue(eventSourceStub())
  })

  it("shows the active conversation title in the chat header", async () => {
    agentHostMocks.listConversationMessages.mockResolvedValue([])

    render(
      <AgentChatPanel
        workspaceId="doc_1"
        activeConversationId="conv_1"
        activeConversationTitle="Resume quality review"
        contextSources={[]}
        onConversationCreated={() => {}}
      />,
    )

    expect(await screen.findByText("Resume quality review")).toBeInTheDocument()
    expect(screen.queryByText("AI 助手")).not.toBeInTheDocument()
  })

  it("hides the AI panel from the chat header", async () => {
    const onHide = vi.fn()
    agentHostMocks.listConversationMessages.mockResolvedValue([])

    render(
      <AgentChatPanel
        workspaceId="doc_1"
        contextSources={[]}
        onConversationCreated={() => {}}
        onHide={onHide}
      />,
    )

    const hideButton = await screen.findByRole("button", { name: "隐藏 AI 面板" })
    expect(hideButton.querySelector('[data-icon-name="panel-right"]')).toBeInTheDocument()
    fireEvent.click(hideButton)
    expect(onHide).toHaveBeenCalledOnce()
  })

  it("renders the composer as an editable textbox", async () => {
    agentHostMocks.listConversationMessages.mockResolvedValue([])

    render(
      <AgentChatPanel
        workspaceId="doc_1"
        activeConversationId="conv_1"
        contextSources={[]}
        onConversationCreated={() => {}}
      />,
    )

    const input = await screen.findByRole("textbox")
    expect(input).toHaveAttribute("data-placeholder")

    typeComposerText(input, "Check this resume")

    expect(input).toHaveTextContent("Check this resume")
    expect(input).toHaveClass("text-foreground")
    expect(input).not.toHaveClass("text-transparent")
  })

  it("keeps the caret after an inserted context mention", async () => {
    agentHostMocks.listConversationMessages.mockResolvedValue([])
    const contextSources: ContextSource[] = [
      {
        id: "ctx_hbs",
        workspace_id: "doc_1",
        type: "directory",
        title: "hbs-commander",
        uri: "file:///E:/hbs-commander",
        metadata: { permission: "read" },
        created_at: "2026-06-16T08:00:00.000Z",
        updated_at: "2026-06-16T08:00:00.000Z",
      },
    ]

    render(
      <AgentChatPanel
        workspaceId="doc_1"
        activeConversationId="conv_1"
        contextSources={contextSources}
        onConversationCreated={() => {}}
      />,
    )

    const input = await screen.findByRole("textbox")
    typeComposerText(input, "33333 @h")

    fireEvent.click(await screen.findByText("hbs-commander"))

    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })

    const token = screen.getByText("hbs-commander").closest("[data-mention-token]")
    expect(token).toBeInTheDocument()
    expect(token).toHaveClass("bg-primary/10")
    const selection = window.getSelection()
    expect(selection?.anchorNode?.textContent).toBe(" ")
    expect(selection?.anchorOffset).toBe(1)
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

  it("does not label failed or empty assistant runs as processed", async () => {
    agentHostMocks.listConversationMessages.mockResolvedValue([
      assistantMessage("", "run_failed"),
      assistantMessage("", "run_empty"),
    ])
    agentHostMocks.listAgentRunEvents.mockImplementation(async (runId: string) => (
      runId === "run_failed"
        ? [
            {
              id: "evt_failed_0",
              run_id: "run_failed",
              sequence: 0,
              type: "harness_event",
              created_at: "2026-06-16T08:00:00.000Z",
              payload: {},
            },
            {
              id: "evt_failed_1",
              run_id: "run_failed",
              sequence: 1,
              type: "run_failed",
              created_at: "2026-06-16T08:00:48.000Z",
              payload: { error: { message: "socket closed" } },
            },
          ]
        : [
            {
              id: "evt_empty_0",
              run_id: "run_empty",
              sequence: 0,
              type: "harness_event",
              created_at: "2026-06-16T08:01:00.000Z",
              payload: {},
            },
            {
              id: "evt_empty_1",
              run_id: "run_empty",
              sequence: 1,
              type: "run_completed",
              created_at: "2026-06-16T08:01:48.000Z",
              payload: { output: { empty: true } },
            },
          ]
    ))

    render(
      <AgentChatPanel
        workspaceId="doc_1"
        activeConversationId="conv_1"
        contextSources={[]}
        onConversationCreated={() => {}}
      />,
    )

    expect(await screen.findByText("处理失败 48s")).toBeInTheDocument()
    expect(await screen.findByText("未生成回复 48s")).toBeInTheDocument()
    expect(screen.queryByText(/已处理/)).not.toBeInTheDocument()
  })

  it("loads the newly created conversation after sending the first prompt", async () => {
    const onConversationUpdated = vi.fn()
    agentHostMocks.createWorkspaceConversation.mockResolvedValue({
      id: "conv_new",
      workspace_id: "doc_1",
      name: null,
      preview: "",
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
        onConversationUpdated={onConversationUpdated}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "检查这份简历质量" }))
    fireEvent.keyDown(screen.getByLabelText("AI 输入"), { key: "Enter" })

    await waitFor(() => expect(agentHostMocks.startConversationRun).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(agentHostMocks.listConversationMessages).toHaveBeenCalledWith("conv_new"))
    await waitFor(() => expect(onConversationUpdated).toHaveBeenCalled())
    expect(screen.getByText("检查这份简历质量")).toBeInTheDocument()
    expect(agentHostMocks.startConversationRun).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: "conv_new",
      context: { document_id: "doc_1" },
    }))
  })

  it("streams assistant deltas into the visible answer content", async () => {
    const eventSource = controllableEventSource()
    agentHostMocks.createAgentRunEventSource.mockReturnValue(eventSource.source)
    agentHostMocks.startConversationRun.mockResolvedValue({
      id: "run_stream",
      conversation_id: "conv_1",
      assistant_message_id: "msg_assistant_run_stream",
      status: "running",
      model: "deepseek-v4-flash",
      mutation_mode: "review",
      started_at: "2026-06-16T08:00:00.000Z",
    })
    agentHostMocks.listConversationMessages
      .mockResolvedValueOnce([])
      .mockResolvedValue([userMessage("Check this resume"), assistantMessage("", "run_stream")])

    render(
      <AgentChatPanel
        workspaceId="doc_1"
        activeConversationId="conv_1"
        contextSources={[]}
        onConversationCreated={() => {}}
      />,
    )

    const input = screen.getByRole("textbox")
    typeComposerText(input, "Check this resume")
    fireEvent.keyDown(input, { key: "Enter" })

    await waitFor(() => expect(agentHostMocks.createAgentRunEventSource).toHaveBeenCalledWith("run_stream"))

    act(() => {
      eventSource.dispatch("assistant_delta", {
        id: "evt_delta_1",
        run_id: "run_stream",
        sequence: 0,
        type: "assistant_delta",
        created_at: "2026-06-16T08:00:01.000Z",
        payload: { delta: "Streaming " },
      })
      eventSource.dispatch("assistant_delta", {
        id: "evt_delta_2",
        run_id: "run_stream",
        sequence: 1,
        type: "assistant_delta",
        created_at: "2026-06-16T08:00:02.000Z",
        payload: { delta: "answer" },
      })
    })

    expect(await screen.findByText("Streaming answer")).toBeInTheDocument()
  })

  it("keeps the message list pinned to the bottom while assistant output streams", async () => {
    const eventSource = controllableEventSource()
    agentHostMocks.createAgentRunEventSource.mockReturnValue(eventSource.source)
    agentHostMocks.startConversationRun.mockResolvedValue({
      id: "run_scroll_follow",
      conversation_id: "conv_1",
      assistant_message_id: "msg_assistant_run_scroll_follow",
      status: "running",
      model: "deepseek-v4-flash",
      mutation_mode: "review",
      started_at: "2026-06-16T08:00:00.000Z",
    })
    agentHostMocks.listConversationMessages
      .mockResolvedValueOnce([])
      .mockResolvedValue([userMessage("Check this resume"), assistantMessage("", "run_scroll_follow")])

    render(
      <AgentChatPanel
        workspaceId="doc_1"
        activeConversationId="conv_1"
        contextSources={[]}
        onConversationCreated={() => {}}
      />,
    )

    const input = screen.getByRole("textbox")
    typeComposerText(input, "Check this resume")
    fireEvent.keyDown(input, { key: "Enter" })

    await waitFor(() => expect(agentHostMocks.createAgentRunEventSource).toHaveBeenCalledWith("run_scroll_follow"))
    const messageList = screen.getByTestId("agent-chat-messages")
    const scroll = mockMessageListScroll(messageList, { clientHeight: 200, scrollHeight: 400, scrollTop: 200 })
    scroll.setScrollHeight(460)

    act(() => {
      eventSource.dispatch("assistant_delta", {
        id: "evt_scroll_follow_1",
        run_id: "run_scroll_follow",
        sequence: 0,
        type: "assistant_delta",
        created_at: "2026-06-16T08:00:01.000Z",
        payload: { delta: "Streaming answer" },
      })
    })

    expect(messageList.scrollTop).toBe(460)
  })

  it("pauses auto-follow after manual scrolling and restores it from the bottom button", async () => {
    const eventSource = controllableEventSource()
    agentHostMocks.createAgentRunEventSource.mockReturnValue(eventSource.source)
    agentHostMocks.startConversationRun.mockResolvedValue({
      id: "run_scroll_resume",
      conversation_id: "conv_1",
      assistant_message_id: "msg_assistant_run_scroll_resume",
      status: "running",
      model: "deepseek-v4-flash",
      mutation_mode: "review",
      started_at: "2026-06-16T08:00:00.000Z",
    })
    agentHostMocks.listConversationMessages
      .mockResolvedValueOnce([])
      .mockResolvedValue([userMessage("Check this resume"), assistantMessage("", "run_scroll_resume")])

    render(
      <AgentChatPanel
        workspaceId="doc_1"
        activeConversationId="conv_1"
        contextSources={[]}
        onConversationCreated={() => {}}
      />,
    )

    const input = screen.getByRole("textbox")
    typeComposerText(input, "Check this resume")
    fireEvent.keyDown(input, { key: "Enter" })

    await waitFor(() => expect(agentHostMocks.createAgentRunEventSource).toHaveBeenCalledWith("run_scroll_resume"))
    const messageList = screen.getByTestId("agent-chat-messages")
    const scroll = mockMessageListScroll(messageList, { clientHeight: 200, scrollHeight: 500, scrollTop: 80 })
    fireEvent.scroll(messageList)

    const returnToBottom = await screen.findByRole("button", { name: "回到底部" })
    scroll.setScrollHeight(560)
    act(() => {
      eventSource.dispatch("assistant_delta", {
        id: "evt_scroll_resume_1",
        run_id: "run_scroll_resume",
        sequence: 0,
        type: "assistant_delta",
        created_at: "2026-06-16T08:00:01.000Z",
        payload: { delta: "First chunk" },
      })
    })
    expect(messageList.scrollTop).toBe(80)

    fireEvent.click(returnToBottom)
    expect(scroll.scrollTo).toHaveBeenCalledWith({ top: 560, behavior: "smooth" })

    messageList.scrollTop = 360
    fireEvent.scroll(messageList)
    expect(screen.queryByRole("button", { name: "回到底部" })).not.toBeInTheDocument()

    scroll.setScrollHeight(620)
    act(() => {
      eventSource.dispatch("assistant_delta", {
        id: "evt_scroll_resume_2",
        run_id: "run_scroll_resume",
        sequence: 1,
        type: "assistant_delta",
        created_at: "2026-06-16T08:00:02.000Z",
        payload: { delta: " second chunk" },
      })
    })
    expect(messageList.scrollTop).toBe(620)
  })

  it("lets users inspect live thinking while a run is still in progress", async () => {
    const eventSource = controllableEventSource()
    agentHostMocks.createAgentRunEventSource.mockReturnValue(eventSource.source)
    agentHostMocks.startConversationRun.mockResolvedValue({
      id: "run_thinking",
      conversation_id: "conv_1",
      assistant_message_id: "msg_assistant_run_thinking",
      status: "running",
      model: "deepseek-v4-flash",
      mutation_mode: "review",
      started_at: "2026-06-16T08:00:00.000Z",
    })
    agentHostMocks.listConversationMessages
      .mockResolvedValueOnce([])
      .mockResolvedValue([userMessage("Check this resume"), assistantMessage("", "run_thinking")])

    render(
      <AgentChatPanel
        workspaceId="doc_1"
        activeConversationId="conv_1"
        contextSources={[]}
        onConversationCreated={() => {}}
      />,
    )

    const input = screen.getByRole("textbox")
    typeComposerText(input, "Check this resume")
    fireEvent.keyDown(input, { key: "Enter" })

    await waitFor(() => expect(agentHostMocks.createAgentRunEventSource).toHaveBeenCalledWith("run_thinking"))

    act(() => {
      eventSource.dispatch("thinking_delta", {
        id: "evt_thinking_1",
        run_id: "run_thinking",
        sequence: 0,
        type: "thinking_delta",
        created_at: "2026-06-16T08:00:01.000Z",
        payload: { delta: "Reading the resume and job context." },
      })
    })

    const toggle = await screen.findByRole("button", { name: /正在思考/ })
    expect(screen.queryByText("Reading the resume and job context.")).not.toBeInTheDocument()

    fireEvent.click(toggle)

    expect(screen.getByText("思考内容")).toBeInTheDocument()
    expect(screen.getByText("Reading the resume and job context.")).toBeInTheDocument()

    act(() => {
      eventSource.dispatch("harness_event", {
        id: "evt_plan_1",
        run_id: "run_thinking",
        sequence: 1,
        type: "harness_event",
        created_at: "2026-06-16T08:00:02.000Z",
        payload: { event: { type: "plan.updated" } },
      })
    })

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /正在思考/ })).not.toBeInTheDocument()
    })
    expect(screen.queryByText("Reading the resume and job context.")).not.toBeInTheDocument()
  })

  it("hides the in-progress status after assistant output starts", async () => {
    const eventSource = controllableEventSource()
    agentHostMocks.createAgentRunEventSource.mockReturnValue(eventSource.source)
    agentHostMocks.startConversationRun.mockResolvedValue({
      id: "run_output",
      conversation_id: "conv_1",
      assistant_message_id: "msg_assistant_run_output",
      status: "running",
      model: "deepseek-v4-flash",
      mutation_mode: "review",
      started_at: "2026-06-16T08:00:00.000Z",
    })
    agentHostMocks.listConversationMessages
      .mockResolvedValueOnce([])
      .mockResolvedValue([userMessage("Check this resume"), assistantMessage("", "run_output")])

    render(
      <AgentChatPanel
        workspaceId="doc_1"
        activeConversationId="conv_1"
        contextSources={[]}
        onConversationCreated={() => {}}
      />,
    )

    const input = screen.getByRole("textbox")
    typeComposerText(input, "Check this resume")
    fireEvent.keyDown(input, { key: "Enter" })

    await waitFor(() => expect(agentHostMocks.createAgentRunEventSource).toHaveBeenCalledWith("run_output"))

    act(() => {
      eventSource.dispatch("thinking_delta", {
        id: "evt_output_thinking",
        run_id: "run_output",
        sequence: 0,
        type: "thinking_delta",
        created_at: "2026-06-16T08:00:01.000Z",
        payload: { delta: "Inspecting the resume." },
      })
    })

    expect(await screen.findByRole("button", { name: /正在思考/ })).toBeInTheDocument()

    act(() => {
      eventSource.dispatch("assistant_delta", {
        id: "evt_output_answer",
        run_id: "run_output",
        sequence: 1,
        type: "assistant_delta",
        created_at: "2026-06-16T08:00:02.000Z",
        payload: { delta: "Here is the review." },
      })
    })

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /正在思考/ })).not.toBeInTheDocument()
    })
    expect(screen.queryByRole("button", { name: /正在处理/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /正在回复/ })).not.toBeInTheDocument()
    expect(screen.getByText("Here is the review.")).toBeInTheDocument()
  })

  it("shows completed processing traces without exposing raw thinking", async () => {
    agentHostMocks.listConversationMessages.mockResolvedValue([
      assistantMessage("可以优化专业技能。", "run_trace"),
    ])
    agentHostMocks.listAgentRunEvents.mockResolvedValue([
      {
        id: "evt_trace_0",
        run_id: "run_trace",
        sequence: 0,
        type: "harness_event",
        created_at: "2026-06-16T08:00:00.000Z",
        payload: {},
      },
      {
        id: "evt_trace_1",
        run_id: "run_trace",
        sequence: 1,
        type: "thinking_delta",
        created_at: "2026-06-16T08:00:01.000Z",
        payload: { delta: "我会先读取上下文。" },
      },
      {
        id: "evt_trace_2",
        run_id: "run_trace",
        sequence: 2,
        type: "tool_call_started",
        created_at: "2026-06-16T08:00:02.000Z",
        payload: {
          tool_call: {
            id: "call_1",
            name: "alpha.readContext",
            input: { context_id: "ctx_1" },
          },
        },
      },
      {
        id: "evt_trace_3",
        run_id: "run_trace",
        sequence: 3,
        type: "tool_call_completed",
        created_at: "2026-06-16T08:00:05.000Z",
        payload: {
          result: {
            tool_call_id: "call_1",
            status: "completed",
            output: { issues: ["missing evidence"] },
          },
        },
      },
      {
        id: "evt_trace_4",
        run_id: "run_trace",
        sequence: 4,
        type: "run_completed",
        created_at: "2026-06-16T08:00:05.000Z",
        payload: { output: { ok: true } },
      },
    ])

    render(
      <AgentChatPanel
        workspaceId="doc_1"
        activeConversationId="conv_1"
        contextSources={[]}
        onConversationCreated={() => {}}
      />,
    )

    const toggle = await screen.findByRole("button", { name: /已处理 5s/ })
    expect(screen.getByText("结论")).toBeInTheDocument()
    expect(screen.getByText("可以优化专业技能。")).toBeInTheDocument()
    expect(screen.queryByText("我会先读取上下文。")).not.toBeInTheDocument()

    fireEvent.click(toggle)

    expect(screen.getByText("分析请求与上下文")).toBeInTheDocument()
    expect(screen.queryByText("我会先读取上下文。")).not.toBeInTheDocument()
    expect(screen.getByText("alpha.readContext")).toBeInTheDocument()
    expect(screen.getByText(/已持续 3s/)).toBeInTheDocument()
  })
})
