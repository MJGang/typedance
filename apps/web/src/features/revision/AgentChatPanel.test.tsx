import "@testing-library/jest-dom/vitest"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AgentMessage, ContextSource } from "@typedance/contracts"
import { AgentChatPanel } from "./AgentChatPanel"

const agentHostMocks = vi.hoisted(() => ({
  getModelSelection: vi.fn(),
  updateModelSelection: vi.fn(),
  getConversationStatistics: vi.fn(),
  getConversationActiveRun: vi.fn(),
  cancelAgentRun: vi.fn(),
  createWorkspaceConversation: vi.fn(),
  createAgentRunEventSource: vi.fn(),
  listAgentRunEvents: vi.fn(),
  listConversationMessages: vi.fn(),
  startConversationRun: vi.fn(),
  sendAgentRunInput: vi.fn(),
}))

vi.mock("@assistant-ui/react", () => ({
  AssistantRuntimeProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useLocalRuntime: () => ({}),
}))

vi.mock("@/agentHost", () => ({
  getModelSelection: (...args: unknown[]) => agentHostMocks.getModelSelection(...args),
  updateModelSelection: (...args: unknown[]) => agentHostMocks.updateModelSelection(...args),
  getConversationStatistics: (...args: unknown[]) => agentHostMocks.getConversationStatistics(...args),
  getConversationActiveRun: (...args: unknown[]) => agentHostMocks.getConversationActiveRun(...args),
  cancelAgentRun: (...args: unknown[]) => agentHostMocks.cancelAgentRun(...args),
  createWorkspaceConversation: (...args: unknown[]) => agentHostMocks.createWorkspaceConversation(...args),
  createAgentRunEventSource: (...args: unknown[]) => agentHostMocks.createAgentRunEventSource(...args),
  listAgentRunEvents: (...args: unknown[]) => agentHostMocks.listAgentRunEvents(...args),
  listConversationMessages: (...args: unknown[]) => agentHostMocks.listConversationMessages(...args),
  startConversationRun: (...args: unknown[]) => agentHostMocks.startConversationRun(...args),
  sendAgentRunInput: (...args: unknown[]) => agentHostMocks.sendAgentRunInput(...args),
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
    agentHostMocks.getModelSelection.mockResolvedValue({ model: "deepseek-flash", reasoning_effort: "high", models: [
      { id: "deepseek-flash", name: "DeepSeek-V4.1-Flash", context_window: 1_000_000, reasoning_efforts: ["off", "low", "high", "max"] },
    ] })
    agentHostMocks.getConversationStatistics.mockResolvedValue({ turns: 0, steps: 0, model_ms: 0, tool_ms: 0, ttft_ms: null, tokens_per_second: null,
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0, cache_read_tokens: 0, cache_miss_tokens: 0, cache_hit_percent: null, measured_calls: 0, unmeasured_calls: 0 }, context: null })
    agentHostMocks.getConversationActiveRun.mockResolvedValue(null)
    agentHostMocks.listAgentRunEvents.mockResolvedValue([])
    agentHostMocks.createAgentRunEventSource.mockReturnValue(eventSourceStub())
  })

  it("resumes the latest recoverable run without sending or clearing the current draft", async () => {
    agentHostMocks.listConversationMessages.mockResolvedValue([assistantMessage("未完成", "failed-run")])
    agentHostMocks.listAgentRunEvents.mockResolvedValue([{ id: "ended", run_id: "failed-run", sequence: 0, type: "run_cancelled", created_at: "2026-06-16T08:00:01.000Z", payload: { recoverable: true } }])
    agentHostMocks.startConversationRun.mockResolvedValue({ id: "new-run", conversation_id: "conv_1", status: "running", mutation_mode: "review", started_at: "2026-06-16T08:00:02.000Z" })
    render(<AgentChatPanel workspaceId="doc_1" activeConversationId="conv_1" contextSources={[]} onConversationCreated={() => {}} />)
    const resume = await screen.findByRole("button", { name: "继续任务" })
    typeComposerText(screen.getByRole("textbox", { name: "AI 输入" }), "还没写完的草稿")
    fireEvent.click(resume)
    await waitFor(() => expect(agentHostMocks.startConversationRun).toHaveBeenCalledWith(expect.objectContaining({ resumeFromRunId: "failed-run", content: expect.stringContaining("继续未完成的任务"), mentions: [] })))
    expect(screen.getByRole("textbox", { name: "AI 输入" })).toHaveTextContent("还没写完的草稿")
  })

  it("pastes an image as a removable card, sends attachment-only input and keeps it on send failure", async () => {
    agentHostMocks.listConversationMessages.mockResolvedValue([])
    agentHostMocks.startConversationRun.mockRejectedValue(new Error("发送失败"))
    render(<AgentChatPanel workspaceId="doc_1" activeConversationId="conv_1" contextSources={[]} onConversationCreated={() => {}} />)
    const image = new File([new Uint8Array([137, 80, 78, 71])], "screen.png", { type: "image/png" })
    fireEvent.paste(screen.getByRole("textbox"), { clipboardData: { files: [image], getData: () => "" } })
    expect(await screen.findByRole("img", { name: "screen.png" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /^发送$/ }))
    await waitFor(() => expect(agentHostMocks.startConversationRun).toHaveBeenCalledWith(expect.objectContaining({
      content: "请阅读这些附件。", attachments: [expect.objectContaining({ name: "screen.png", content: expect.objectContaining({ type: "image" }) })],
    })))
    expect(screen.getByRole("img", { name: "screen.png" })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole("button", { name: "移除附件 screen.png" })).toBeEnabled())
    fireEvent.click(screen.getByRole("button", { name: "移除附件 screen.png" }))
    expect(screen.queryByRole("img", { name: "screen.png" })).not.toBeInTheDocument()
  })

  it("retains independent unsent text and attachments when switching conversations", async () => {
    agentHostMocks.listConversationMessages.mockResolvedValue([])
    const props = { workspaceId: "doc_1", contextSources: [], onConversationCreated: () => {} }
    const view = render(<AgentChatPanel {...props} activeConversationId="a" />)
    typeComposerText(screen.getByRole("textbox"), "对话 A 的草稿")
    fireEvent.paste(screen.getByRole("textbox"), { clipboardData: { files: [new File(["image"], "a.png", { type: "image/png" })], getData: () => "" } })
    await screen.findByRole("img", { name: "a.png" })
    await act(async () => view.rerender(<AgentChatPanel {...props} activeConversationId="b" />))
    expect(screen.getByRole("textbox")).toBeEmptyDOMElement()
    expect(screen.queryByRole("img", { name: "a.png" })).not.toBeInTheDocument()
    typeComposerText(screen.getByRole("textbox"), "对话 B 的草稿")
    await act(async () => view.rerender(<AgentChatPanel {...props} activeConversationId="a" />))
    expect(screen.getByRole("textbox")).toHaveTextContent("对话 A 的草稿")
    expect(screen.getByRole("img", { name: "a.png" })).toBeInTheDocument()
  })

  it("opens an empty new-conversation draft without carrying the previous draft attachments", async () => {
    agentHostMocks.listConversationMessages.mockResolvedValue([])
    const props = { workspaceId: "doc_1", contextSources: [], onConversationCreated: () => {} }
    const view = render(<AgentChatPanel {...props} activeConversationId="a" />)
    typeComposerText(screen.getByRole("textbox"), "原对话尚未发送")
    fireEvent.paste(screen.getByRole("textbox"), { clipboardData: { files: [new File(["image"], "draft.png", { type: "image/png" })], getData: () => "" } })
    await screen.findByRole("img", { name: "draft.png" })
    await act(async () => view.rerender(<AgentChatPanel {...props} activeConversationId={undefined} />))
    expect(screen.getByRole("textbox")).toBeEmptyDOMElement()
    expect(screen.queryByRole("img", { name: "draft.png" })).not.toBeInTheDocument()
    typeComposerText(screen.getByRole("textbox"), "新对话草稿")
    await act(async () => view.rerender(<AgentChatPanel {...props} activeConversationId="a" />))
    expect(screen.getByRole("textbox")).toHaveTextContent("原对话尚未发送")
    expect(screen.getByRole("img", { name: "draft.png" })).toBeInTheDocument()
    await act(async () => view.rerender(<AgentChatPanel {...props} activeConversationId={undefined} />))
    expect(screen.getByRole("textbox")).toHaveTextContent("新对话草稿")
  })

  it.each([false, true])("transfers a cached new draft to its created conversation and preserves failed sends: failure=%s", async (failure) => {
    agentHostMocks.listConversationMessages.mockResolvedValue([])
    agentHostMocks.createWorkspaceConversation.mockResolvedValue({ id: "created" })
    if (failure) agentHostMocks.startConversationRun.mockRejectedValue(new Error("发送失败"))
    else agentHostMocks.startConversationRun.mockResolvedValue({ id: "sent", conversation_id: "created", status: "running" })
    const props = { workspaceId: "doc_1", contextSources: [], onConversationCreated: (id: string) => view.rerender(<AgentChatPanel {...props} activeConversationId={id} />) }
    const view: ReturnType<typeof render> = render(<AgentChatPanel {...props} />)
    typeComposerText(screen.getByRole("textbox"), "待发送的草稿")
    fireEvent.paste(screen.getByRole("textbox"), { clipboardData: { files: [new File(["image"], "cached.png", { type: "image/png" })], getData: () => "" } })
    await screen.findByRole("img", { name: "cached.png" })
    await act(async () => view.rerender(<AgentChatPanel {...props} activeConversationId="existing" />))
    await act(async () => view.rerender(<AgentChatPanel {...props} />))
    expect(screen.getByRole("textbox")).toHaveTextContent("待发送的草稿")
    fireEvent.click(screen.getByRole("button", { name: /^发送$/ }))
    await waitFor(() => expect(agentHostMocks.startConversationRun).toHaveBeenCalledOnce())
    if (failure) await waitFor(() => expect(screen.getByRole("button", { name: "移除附件 cached.png" })).toBeEnabled())
    else await waitFor(() => expect(screen.getByRole("textbox")).toBeEmptyDOMElement())
    await act(async () => view.rerender(<AgentChatPanel {...props} />))
    expect(screen.getByRole("textbox")).toBeEmptyDOMElement()
    expect(screen.queryByRole("img", { name: "cached.png" })).not.toBeInTheDocument()
    if (failure) {
      await act(async () => view.rerender(<AgentChatPanel {...props} activeConversationId="created" />))
      expect(screen.getByRole("textbox")).toHaveTextContent("待发送的草稿")
      expect(screen.getByRole("img", { name: "cached.png" })).toBeInTheDocument()
    }
  })

  it("pastes plain text without retaining clipboard HTML and does not send while an IME is composing", async () => {
    agentHostMocks.listConversationMessages.mockResolvedValue([])
    render(<AgentChatPanel workspaceId="doc_1" activeConversationId="conv_1" contextSources={[]} onConversationCreated={() => {}} />)
    const composer = screen.getByRole("textbox")
    typeComposerText(composer, "已有草稿")
    fireEvent.paste(composer, { clipboardData: { files: [], getData: (kind: string) => kind === "text/plain" ? "\n粘贴文本" : "<img src=x onerror=alert(1)>" } })
    expect(composer.textContent).toBe("已有草稿\n粘贴文本")
    expect(composer.querySelector("img")).toBeNull()
    fireEvent.keyDown(composer, { key: "Enter", isComposing: true })
    expect(agentHostMocks.startConversationRun).not.toHaveBeenCalled()
    await act(async () => {})
  })

  it("restores an active run and treats a disconnected stream as reconnecting", async () => {
    const events = controllableEventSource()
    agentHostMocks.createAgentRunEventSource.mockReturnValue(events.source)
    agentHostMocks.listConversationMessages.mockResolvedValue([assistantMessage("", "active")])
    agentHostMocks.getConversationActiveRun.mockResolvedValue({ id: "active", conversation_id: "conv_1", status: "running" })
    render(<AgentChatPanel workspaceId="doc_1" activeConversationId="conv_1" contextSources={[]} onConversationCreated={() => {}} />)
    await waitFor(() => expect(agentHostMocks.createAgentRunEventSource).toHaveBeenCalledWith("active"))
    act(() => events.source.onerror?.(new Event("error")))
    expect(screen.getByText("连接中断，正在重连")).toBeInTheDocument()
    expect(screen.queryByText("处理失败")).not.toBeInTheDocument()
    expect(events.source.close).not.toHaveBeenCalled()
    act(() => events.dispatch("assistant_delta", { id: "resume", run_id: "active", sequence: 0, type: "assistant_delta", payload: { delta: "恢复后的回答" }, created_at: "2026-10-21T00:00:00.000Z" }))
    expect(await screen.findByText("恢复后的回答")).toBeInTheDocument()
  })

  it("closes the previous subscription on conversation switch and ignores late events", async () => {
    const events = controllableEventSource()
    agentHostMocks.createAgentRunEventSource.mockReturnValue(events.source)
    agentHostMocks.listConversationMessages.mockImplementation(async (id) => id === "conv_1" ? [assistantMessage("", "active")] : [])
    agentHostMocks.getConversationActiveRun.mockImplementation(async (id) => id === "conv_1" ? { id: "active", status: "running" } : null)
    const props = { workspaceId: "doc_1", contextSources: [], onConversationCreated: () => {} }
    const view = render(<AgentChatPanel {...props} activeConversationId="conv_1" />)
    await waitFor(() => expect(agentHostMocks.createAgentRunEventSource).toHaveBeenCalledWith("active"))
    view.rerender(<AgentChatPanel {...props} activeConversationId="conv_2" />)
    await waitFor(() => expect(events.source.close).toHaveBeenCalled())
    act(() => events.dispatch("assistant_delta", { id: "late", run_id: "active", sequence: 0, type: "assistant_delta", payload: { delta: "旧会话迟到消息" }, created_at: "2026-10-21T00:00:00.000Z" }))
    expect(screen.queryByText("旧会话迟到消息")).not.toBeInTheDocument()
  })

  it("ignores a pending send after the user clears the selected conversation", async () => {
    let finishSend!: (value: unknown) => void
    agentHostMocks.startConversationRun.mockImplementation(() => new Promise((resolve) => { finishSend = resolve }))
    agentHostMocks.listConversationMessages.mockResolvedValue([])
    const props = { workspaceId: "doc_1", contextSources: [], onConversationCreated: () => {} }
    const view = render(<AgentChatPanel {...props} activeConversationId="conv_1" />)
    typeComposerText(screen.getByRole("textbox"), "old conversation request")
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" })
    await waitFor(() => expect(agentHostMocks.startConversationRun).toHaveBeenCalledOnce())
    view.rerender(<AgentChatPanel {...props} activeConversationId={undefined} />)
    await act(async () => { finishSend({ id: "stale", conversation_id: "conv_1", status: "running" }) })
    expect(agentHostMocks.createAgentRunEventSource).not.toHaveBeenCalled()
    expect(screen.getByText("从当前画布开始")).toBeInTheDocument()
  })

  it("does not install a subscription if selection changes while messages are loading", async () => {
    let finishLoad!: (value: unknown) => void
    agentHostMocks.listConversationMessages.mockResolvedValueOnce([])
      .mockImplementationOnce(() => new Promise((resolve) => { finishLoad = resolve }))
    agentHostMocks.startConversationRun.mockResolvedValue({ id: "stale", conversation_id: "conv_1", status: "running" })
    const props = { workspaceId: "doc_1", contextSources: [], onConversationCreated: () => {} }
    const view = render(<AgentChatPanel {...props} activeConversationId="conv_1" />)
    await waitFor(() => expect(agentHostMocks.listConversationMessages).toHaveBeenCalledOnce())
    typeComposerText(screen.getByRole("textbox"), "old conversation request")
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" })
    await waitFor(() => expect(agentHostMocks.listConversationMessages).toHaveBeenCalledTimes(2))
    view.rerender(<AgentChatPanel {...props} activeConversationId={undefined} />)
    await act(async () => { finishLoad([assistantMessage("stale answer", "stale")]) })
    expect(agentHostMocks.createAgentRunEventSource).not.toHaveBeenCalled()
    expect(screen.queryByText("stale answer")).not.toBeInTheDocument()
  })

  it("shows the active conversation title in the chat header", async () => {
    agentHostMocks.listConversationMessages.mockResolvedValue([])
    const onToggleConversationPinned = vi.fn()
    const onRenameConversation = vi.fn()

    render(
      <AgentChatPanel
        workspaceId="doc_1"
        activeConversationId="conv_1"
        activeConversationTitle="Resume quality review"
        activeConversationPinned={false}
        contextSources={[]}
        onConversationCreated={() => {}}
        onToggleConversationPinned={onToggleConversationPinned}
        onRenameConversation={onRenameConversation}
      />,
    )

    expect(await screen.findByText("Resume quality review")).toBeInTheDocument()
    expect(screen.queryByText("AI 助手")).not.toBeInTheDocument()
    expect(screen.queryByText("会话")).not.toBeInTheDocument()

    const menuButton = screen.getByRole("button", { name: "对话操作" })
    fireEvent.keyDown(menuButton, { key: "Enter" })
    fireEvent.click(await screen.findByRole("menuitem", { name: "置顶对话" }))
    expect(onToggleConversationPinned).toHaveBeenCalledOnce()

    fireEvent.keyDown(menuButton, { key: "Enter" })
    fireEvent.click(await screen.findByRole("menuitem", { name: "重命名对话" }))
    expect(onRenameConversation).toHaveBeenCalledOnce()
  })

  it("leaves the chat title area empty without an active conversation", async () => {
    agentHostMocks.listConversationMessages.mockResolvedValue([])

    render(
      <AgentChatPanel
        workspaceId="doc_1"
        contextSources={[]}
        onConversationCreated={() => {}}
      />,
    )

    await screen.findByRole("textbox")
    expect(screen.getByTestId("agent-chat-composer-region")).not.toHaveClass("border-t")
    expect(screen.queryByText("未选择对话")).not.toBeInTheDocument()
    expect(screen.queryByText("新建或选择会话")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "对话操作" })).not.toBeInTheDocument()
  })

  it("shows cancel pinning for the active pinned conversation", async () => {
    agentHostMocks.listConversationMessages.mockResolvedValue([])

    render(
      <AgentChatPanel
        workspaceId="doc_1"
        activeConversationId="conv_1"
        activeConversationTitle="Pinned conversation"
        activeConversationPinned
        contextSources={[]}
        onConversationCreated={() => {}}
        onToggleConversationPinned={() => {}}
      />,
    )

    fireEvent.keyDown(await screen.findByRole("button", { name: "对话操作" }), { key: "Enter" })
    expect(await screen.findByRole("menuitem", { name: "取消置顶对话" })).toBeInTheDocument()
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

    expect(await screen.findByText(/正在思考/)).toBeInTheDocument()
    const toggle = screen.getByRole("button", { name: "思考过程" })
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
      expect(screen.queryByText(/正在思考/)).not.toBeInTheDocument()
    })
    expect(screen.getByText("Reading the resume and job context.")).toBeInTheDocument()
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

    expect(await screen.findByText(/正在思考/)).toBeInTheDocument()

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
      expect(screen.queryByText(/正在思考/)).not.toBeInTheDocument()
    })
    expect(screen.queryByRole("button", { name: /正在处理/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /正在回复/ })).not.toBeInTheDocument()
    expect(screen.getByText("Here is the review.")).toBeInTheDocument()
    expect(screen.getByText(/正在回复/)).toBeInTheDocument()
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

    await screen.findByText(/已处理 5s/)
    expect(screen.queryByText("结论")).not.toBeInTheDocument()
    expect(screen.getByText("可以优化专业技能。")).toBeInTheDocument()
    expect(screen.queryByText("我会先读取上下文。")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /已运行 alpha.readContext/ }))

    expect(screen.queryByText("分析请求与上下文")).not.toBeInTheDocument()
    expect(screen.queryByText("我会先读取上下文。")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /已运行 alpha.readContext/ })).toBeInTheDocument()
    expect(screen.getByText(/已持续 3s/)).toBeInTheDocument()
  })

  it("keeps streaming text, tools, steering and subsequent replies in chronological segments after reload", async () => {
    const runId = "run_segments"
    const steering = { ...userMessage("只调整边距，不改文字"), id: "steer", run_id: runId, conversation_id: "conv_1" }
    agentHostMocks.listConversationMessages.mockResolvedValue([assistantMessage("前面的说明最终答复", runId), steering])
    agentHostMocks.listAgentRunEvents.mockResolvedValue([
      { type: "assistant_delta", payload: { message_id: "0:answer", delta: "前面的说明" } },
      { type: "tool_call_started", payload: { tool_call: { id: "read", name: "resume.inspect", input: {} } } },
      { type: "tool_call_completed", payload: { result: { tool_call_id: "read", status: "completed" } } },
      { type: "user_input_received", payload: { message_id: "steer" } },
      { type: "user_input_applied", payload: { message_id: "steer" } },
      { type: "thinking_delta", payload: { delta: "private reasoning" } },
      { type: "assistant_delta", payload: { message_id: "1:answer", delta: "最终答复" } },
      { type: "run_completed", payload: {} },
    ].map((event, sequence) => ({ ...event, id: `segment-${sequence}`, run_id: runId, sequence, created_at: `2026-06-16T08:00:0${sequence}.000Z` })))
    render(<AgentChatPanel workspaceId="doc_1" activeConversationId="conv_1" contextSources={[]} onConversationCreated={() => {}} />)
    await screen.findByText("最终答复")
    const list = screen.getByTestId("agent-chat-messages")
    expect(list.querySelectorAll("[data-agent-segment-id]")).toHaveLength(2)
    const content = list.textContent!
    expect(content.indexOf("前面的说明")).toBeLessThan(content.indexOf("已运行"))
    expect(content.indexOf("已运行")).toBeLessThan(content.indexOf("只调整边距"))
    expect(content.indexOf("只调整边距")).toBeLessThan(content.indexOf("最终答复"))
    expect(screen.getAllByText("只调整边距，不改文字")).toHaveLength(1)
    expect(screen.queryByText("结论")).not.toBeInTheDocument()
    expect(screen.queryByText("private reasoning")).not.toBeInTheDocument()
    expect(screen.queryByText("将在下一步处理")).not.toBeInTheDocument()
  })

  it("sends follow-up input during a run while preserving a newer draft and switching the primary action", async () => {
    const eventSource = controllableEventSource()
    agentHostMocks.createAgentRunEventSource.mockReturnValue(eventSource.source)
    agentHostMocks.getConversationActiveRun.mockResolvedValue({ id: "run_live", conversation_id: "conv_1", status: "running" })
    agentHostMocks.listConversationMessages.mockResolvedValue([assistantMessage("", "run_live")])
    let accept!: (message: AgentMessage) => void
    agentHostMocks.sendAgentRunInput.mockImplementation(() => new Promise<AgentMessage>((resolve) => { accept = resolve }))
    render(<AgentChatPanel workspaceId="doc_1" activeConversationId="conv_1" contextSources={[]} onConversationCreated={() => {}} />)
    await screen.findByRole("button", { name: "停止" })
    const composer = screen.getByRole("textbox")
    expect(screen.queryByRole("button", { name: "发送" })).not.toBeInTheDocument()
    typeComposerText(composer, "改成左右 64px")
    expect(screen.queryByRole("button", { name: "停止" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "发送" }))
    await waitFor(() => expect(agentHostMocks.sendAgentRunInput).toHaveBeenCalledWith(expect.objectContaining({ runId: "run_live", content: "改成左右 64px" })))
    expect(screen.queryByRole("button", { name: "停止" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled()
    expect(composer).toHaveAttribute("contenteditable", "true")
    typeComposerText(composer, "再补充一点")
    await act(async () => accept({ ...userMessage("改成左右 64px"), id: "steer_live", run_id: "run_live" }))
    expect(composer).toHaveTextContent("再补充一点")
    expect(screen.getByRole("button", { name: "发送" })).toBeEnabled()
    typeComposerText(composer, "   ")
    expect(screen.getByRole("button", { name: "停止" })).toBeEnabled()
    expect(screen.queryByRole("button", { name: "发送" })).not.toBeInTheDocument()
    expect(agentHostMocks.startConversationRun).not.toHaveBeenCalled()
    act(() => eventSource.dispatch("user_input_received", { id: "received", run_id: "run_live", sequence: 0, type: "user_input_received", created_at: "2026-06-16T08:00:01.000Z", payload: { message_id: "steer_live" } }))
    expect(await screen.findByText("改成左右 64px")).toBeInTheDocument()
    expect(screen.getByText("将在下一步处理")).toBeInTheDocument()
    act(() => eventSource.dispatch("assistant_delta", { id: "answer", run_id: "run_live", sequence: 1, type: "assistant_delta", created_at: "2026-06-16T08:00:02.000Z", payload: { message_id: "0:answer", delta: "开始调整" } }))
    expect(screen.getByText("改成左右 64px")).toBeInTheDocument()
    expect(screen.queryByText("改成左右 64px开始调整")).not.toBeInTheDocument()
  })

  it("keeps follow-up input editable when delivery fails", async () => {
    agentHostMocks.getConversationActiveRun.mockResolvedValue({ id: "run_live", conversation_id: "conv_1", status: "running" })
    agentHostMocks.listConversationMessages.mockResolvedValue([assistantMessage("", "run_live")])
    agentHostMocks.sendAgentRunInput.mockRejectedValue(new Error("run ended"))
    render(<AgentChatPanel workspaceId="doc_1" activeConversationId="conv_1" contextSources={[]} onConversationCreated={() => {}} />)
    await screen.findByRole("button", { name: "停止" })
    typeComposerText(screen.getByRole("textbox"), "保留这条补充")
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" })
    await waitFor(() => expect(agentHostMocks.sendAgentRunInput).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByRole("button", { name: "发送" })).toBeEnabled())
    expect(screen.getByRole("textbox")).toHaveTextContent("保留这条补充")
  })

  it("updates inline grouped tool statuses without closing expanded details", async () => {
    const eventSource = controllableEventSource()
    agentHostMocks.createAgentRunEventSource.mockReturnValue(eventSource.source)
    agentHostMocks.getConversationActiveRun.mockResolvedValue({ id: "tools", conversation_id: "conv_1", status: "running" })
    agentHostMocks.listConversationMessages.mockResolvedValue([assistantMessage("", "tools")])
    agentHostMocks.listAgentRunEvents.mockResolvedValue([
      { type: "assistant_delta", payload: { message_id: "0:answer", delta: "我先检查当前画布。" } },
      { type: "tool_call_started", payload: { tool_call: { id: "read", name: "resume.inspect", input: { target: "当前画布" } } } },
      { type: "tool_call_completed", payload: { result: { tool_call_id: "read", status: "completed", output: { ok: true } } } },
      { type: "tool_call_started", payload: { tool_call: { id: "edit", name: "resume.edit", input: { task: "调整边距" } } } },
    ].map((event, sequence) => ({ ...event, id: `tool-${sequence}`, run_id: "tools", sequence, created_at: "2026-06-16T08:00:00.000Z" })))
    render(<AgentChatPanel workspaceId="doc_1" activeConversationId="conv_1" contextSources={[]} onConversationCreated={() => {}} />)
    const group = await screen.findByRole("button", { name: "正在执行 2 项操作" })
    expect(group).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(group)
    expect(screen.getByText(/正在运行 编辑简历/)).toBeInTheDocument()
    act(() => eventSource.dispatch("tool_call_failed", { id: "failed", run_id: "tools", sequence: 4, type: "tool_call_failed", created_at: "2026-06-16T08:00:03.000Z", payload: { result: { tool_call_id: "edit", status: "failed", error: { message: "编辑器拒绝修改" } } } }))
    expect(screen.getByRole("button", { name: "已执行 2 项操作，1 项失败" })).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText(/运行失败 编辑简历/)).toBeInTheDocument()
    expect(screen.getByText(/编辑器拒绝修改/)).toBeInTheDocument()
  })

  it("shows image and file read receipts only when the corresponding event arrives", async () => {
    const eventSource = controllableEventSource()
    agentHostMocks.createAgentRunEventSource.mockReturnValue(eventSource.source)
    agentHostMocks.getConversationActiveRun.mockResolvedValue({ id: "read", conversation_id: "conv_1", status: "running" })
    agentHostMocks.listConversationMessages.mockResolvedValue([assistantMessage("", "read")])
    render(<AgentChatPanel workspaceId="doc_1" activeConversationId="conv_1" contextSources={[]} onConversationCreated={() => {}} />)
    await screen.findByRole("button", { name: "停止" })
    expect(screen.queryByText(/已查看.*张图片/)).not.toBeInTheDocument()
    act(() => eventSource.dispatch("attachments_read", { id: "read-ack", run_id: "read", sequence: 0, type: "attachments_read", created_at: "2026-06-16T08:00:01.000Z", payload: { image_count: 1, file_count: 2 } }))
    expect(screen.getByText("已查看 1 张图片，已读取 2 个文件")).toBeInTheDocument()
    act(() => eventSource.dispatch("assistant_delta", { id: "read-answer", run_id: "read", sequence: 1, type: "assistant_delta", created_at: "2026-06-16T08:00:02.000Z", payload: { message_id: "0:answer", delta: "图片里的边距确实偏窄。" } }))
    const list = screen.getByTestId("agent-chat-messages")
    expect(list.textContent!.indexOf("已查看")).toBeLessThan(list.textContent!.indexOf("图片里的边距"))
  })

  it.each([
    { prefix: "```ts\nconst margin = ", suffix: "64\n```", selector: "pre code", text: "const margin = 64" },
    { prefix: "| 项目 | 说明 |\n| --- | --- |\n| 边距 | ", suffix: "64px |\n", selector: "table", text: "64px" },
    { prefix: "[页面", suffix: "说明](https://example.com/layout)", selector: "a", text: "页面说明" },
  ])("preserves streamed Markdown around steering and after replay: $selector", async ({ prefix, suffix, selector, text }) => {
    const source = controllableEventSource()
    agentHostMocks.createAgentRunEventSource.mockReturnValue(source.source)
    agentHostMocks.getConversationActiveRun.mockResolvedValue({ id: "markdown", conversation_id: "conv_1", status: "running" })
    const steering = { ...userMessage("补充要求"), id: "steer_markdown", conversation_id: "conv_1", run_id: "markdown" }
    const events = [
      { id: "md-start", sequence: 0, type: "assistant_delta", payload: { message_id: "0:markdown", delta: prefix } },
      { id: "md-user", sequence: 1, type: "user_input_received", payload: { message_id: steering.id } },
      { id: "md-end", sequence: 2, type: "assistant_delta", payload: { message_id: "0:markdown", delta: suffix } },
    ].map((event) => ({ ...event, run_id: "markdown", created_at: "2026-06-16T08:00:00.000Z" }))
    agentHostMocks.listConversationMessages.mockResolvedValue([assistantMessage(prefix, "markdown"), steering])
    agentHostMocks.listAgentRunEvents.mockResolvedValue(events.slice(0, 2))
    const props = { workspaceId: "doc_1", activeConversationId: "conv_1", contextSources: [], onConversationCreated: () => {} }
    const view = render(<AgentChatPanel {...props} />)
    await screen.findByText("补充要求")
    act(() => source.dispatch("assistant_delta", events[2]))
    const list = screen.getByTestId("agent-chat-messages")
    expect(list.querySelectorAll("[data-agent-segment-id]")).toHaveLength(1)
    expect(list.querySelector(selector)).toHaveTextContent(text)
    expect(list.textContent!.indexOf(text)).toBeLessThan(list.textContent!.indexOf("补充要求"))
    if (selector === "a") expect(list.querySelector("a")).toHaveAttribute("href", "https://example.com/layout")
    view.unmount()
    agentHostMocks.getConversationActiveRun.mockResolvedValue(null)
    agentHostMocks.listConversationMessages.mockResolvedValue([assistantMessage(prefix + suffix, "markdown"), steering])
    agentHostMocks.listAgentRunEvents.mockResolvedValue([...events, { id: "md-done", sequence: 3, type: "run_completed", payload: {}, run_id: "markdown", created_at: "2026-06-16T08:00:01.000Z" }])
    render(<AgentChatPanel {...props} />)
    await screen.findByText("补充要求")
    const replay = screen.getByTestId("agent-chat-messages")
    expect(replay.querySelectorAll("[data-agent-segment-id]")).toHaveLength(1)
    expect(replay.querySelector(selector)).toHaveTextContent(text)
    expect(screen.getAllByText("补充要求")).toHaveLength(1)
  })
})
