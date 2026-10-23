import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter } from "@assistant-ui/react"
import { ArrowUp, ChevronDown, ChevronRight, Loader2, Mic, MoreHorizontal, PanelRight, Pin, Plus, ShieldCheck, Square, SquarePen, WandSparkles, X } from "lucide-react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { useEditorReferences } from "./references/EditorReferences"
import { ReferenceComposer, MessageReferences } from "./references/ReferenceComposer"
import { MessageReferenceSelection } from "./references/MessageReferenceSelection"
import { EditorRequestCard, editorRequests } from "./EditorRequestCard"
import { ChatAttachments } from "./ChatAttachments"
import { attachmentAccept, readChatAttachment } from "./readChatAttachment"
import { useVoiceInput } from "./useVoiceInput"
import { harnessAttachmentsSchema, type HarnessAttachment } from "@typedance/contracts"
import {
  cancelAgentRun,
  createWorkspaceConversation,
  createAgentRunEventSource,
  getConversationActiveRun,
  listAgentRunEvents,
  listConversationMessages,
  startConversationRun,
} from "@/agentHost"
import type {
  AgentMessage,
  AgentRun,
  AgentRunEvent,
  CanvasMutationMode,
  ContextMention,
  ContextSource,
} from "@typedance/contracts"

type AgentChatPanelProps = {
  workspaceId: string
  activeConversationId?: string
  activeConversationTitle?: string
  activeConversationPinned?: boolean
  contextSources: ContextSource[]
  onConversationCreated: (conversationId: string) => void
  onConversationUpdated?: () => void
  onToggleConversationPinned?: () => void
  onRenameConversation?: () => void
  onCanvasPatchApplied?: (event: AgentRunEvent) => void
  onHide?: () => void
}

const mutationModeLabels: Record<CanvasMutationMode, string> = {
  suggest: "建议模式",
  review: "手动应用",
  solo: "自动修改",
}
const defaultAgentModel = import.meta.env.VITE_DEFAULT_AGENT_MODEL?.trim() || undefined

const terminalEvents = new Set<AgentRunEvent["type"]>(["run_completed", "run_failed", "run_cancelled"])
const streamedEventTypes: AgentRunEvent["type"][] = [
  "thinking_delta",
  "assistant_delta",
  "tool_call_started",
  "tool_call_delta",
  "tool_call_completed",
  "tool_call_failed",
  "canvas_patch_proposed",
  "canvas_patch_applied",
  "text_edit_decision",
  "editor_request",
  "editor_response",
  "run_completed",
  "run_failed",
  "run_cancelled",
  "harness_event",
]

const RUN_TRACE_COPY = {
  thinkingStatus: "正在思考",
  thinkingHeading: "思考内容",
  preparingContext: "正在准备上下文",
  emptyCompletedTrace: "暂无处理过程",
  reasoningSummaryStep: "分析请求与上下文",
}

const CHAT_BOTTOM_THRESHOLD_PX = 24

function isNearChatBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= CHAT_BOTTOM_THRESHOLD_PX
}

function getRunStatusLabel(terminal: AgentRunEvent, message: AgentMessage): string {
  if (terminal.type === "run_failed") return "处理失败"
  if (terminal.type === "run_cancelled") return "已停止"

  if (terminal.type === "run_completed") {
    const output = terminal.payload.output
    const isEmptyOutput = typeof output === "object" && output !== null && "empty" in output && (output as { empty?: unknown }).empty === true
    if (isEmptyOutput || message.content.trim().length === 0) return "未生成回复"
    return "已处理"
  }

  return "状态未知"
}

function getInProgressRunStatusLabel(events: AgentRunEvent[]): string | null {
  if (events[events.length - 1]?.type === "thinking_delta") return RUN_TRACE_COPY.thinkingStatus
  return null
}

const assistantMarkdownComponents: Components = {
  h1: ({ node: _node, ...props }) => <h1 className="mb-3 mt-5 text-lg font-semibold leading-7 text-foreground first:mt-0" {...props} />,
  h2: ({ node: _node, ...props }) => <h2 className="mb-3 mt-5 text-base font-semibold leading-7 text-foreground first:mt-0" {...props} />,
  h3: ({ node: _node, ...props }) => <h3 className="mb-2 mt-5 text-sm font-semibold leading-6 text-foreground first:mt-0" {...props} />,
  p: ({ node: _node, ...props }) => <p className="my-3 text-sm leading-7 text-foreground first:mt-0 last:mb-0" {...props} />,
  strong: ({ node: _node, ...props }) => <strong className="font-semibold text-foreground" {...props} />,
  em: ({ node: _node, ...props }) => <em className="italic" {...props} />,
  hr: ({ node: _node, ...props }) => <hr className="my-5 border-border" {...props} />,
  ul: ({ node: _node, ...props }) => <ul className="my-3 list-disc space-y-1 pl-5 text-sm leading-7" {...props} />,
  ol: ({ node: _node, ...props }) => <ol className="my-3 list-decimal space-y-1 pl-5 text-sm leading-7" {...props} />,
  li: ({ node: _node, ...props }) => <li className="pl-1" {...props} />,
  blockquote: ({ node: _node, ...props }) => <blockquote className="my-3 border-l-2 border-border pl-3 text-sm leading-7 text-muted-foreground" {...props} />,
  table: ({ node: _node, ...props }) => (
    <div className="my-3 overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-max border-collapse text-left text-xs leading-5" {...props} />
    </div>
  ),
  thead: ({ node: _node, ...props }) => <thead className="bg-muted/70 text-foreground" {...props} />,
  th: ({ node: _node, ...props }) => <th className="border-b border-r border-border px-2.5 py-2 font-semibold last:border-r-0" {...props} />,
  td: ({ node: _node, ...props }) => <td className="border-b border-r border-border px-2.5 py-2 align-top last:border-r-0 [&_p]:m-0" {...props} />,
  code: ({ node: _node, ...props }) => <code className="rounded bg-muted px-1 py-0.5 text-[0.85em] text-foreground" {...props} />,
  pre: ({ node: _node, ...props }) => <pre className="my-3 overflow-x-auto rounded-md bg-muted p-3 text-xs leading-6 text-foreground" {...props} />,
  a: ({ node: _node, ...props }) => <a className="font-medium text-primary underline underline-offset-4" target="_blank" rel="noreferrer" {...props} />,
}

export function AgentChatPanel({
  workspaceId,
  activeConversationId,
  activeConversationTitle,
  activeConversationPinned,
  contextSources,
  onConversationCreated,
  onConversationUpdated,
  onToggleConversationPinned,
  onRenameConversation,
  onCanvasPatchApplied,
  onHide,
}: AgentChatPanelProps) {
  const runtime = useAssistantUiShellRuntime()
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AgentChatContent
        workspaceId={workspaceId}
        activeConversationId={activeConversationId}
        activeConversationTitle={activeConversationTitle}
        activeConversationPinned={activeConversationPinned}
        contextSources={contextSources}
        onConversationCreated={onConversationCreated}
        onConversationUpdated={onConversationUpdated}
        onToggleConversationPinned={onToggleConversationPinned}
        onRenameConversation={onRenameConversation}
        onCanvasPatchApplied={onCanvasPatchApplied}
        onHide={onHide}
      />
    </AssistantRuntimeProvider>
  )
}

function AgentChatContent({
  workspaceId,
  activeConversationId,
  activeConversationTitle,
  activeConversationPinned,
  contextSources,
  onConversationCreated,
  onConversationUpdated,
  onToggleConversationPinned,
  onRenameConversation,
  onCanvasPatchApplied,
  onHide,
}: AgentChatPanelProps) {
  const editorReferences = useEditorReferences()
  const registerComposer = editorReferences?.registerComposer
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [runEvents, setRunEvents] = useState<Record<string, AgentRunEvent[]>>({})
  const [runningRunId, setRunningRunId] = useState<string | null>(null)
  const [reconnecting, setReconnecting] = useState(false)
  const [input, setInput] = useState("")
  const [attachments, setAttachments] = useState<HarnessAttachment[]>([])
  const [attachmentLoading, setAttachmentLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const attachmentOperation = useRef<AbortController | null>(null)
  const attachmentPicker = useRef<HTMLInputElement>(null)
  const scope = `${workspaceId}:${activeConversationId ?? "new"}`
  const voice = useVoiceInput(scope, (text) => {
    setInput((current) => `${current}${current && !/\s$/.test(current) ? " " : ""}${text}`)
    requestAnimationFrame(() => composerRef.current?.focus())
  })
  const [mentions, setMentions] = useState<ContextMention[]>([])
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mutationMode, setMutationMode] = useState<CanvasMutationMode>("review")
  const [model] = useState(defaultAgentModel)
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(() => new Set())
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const composerRef = useRef<HTMLDivElement>(null)
  useEffect(() => registerComposer?.(() => composerRef.current?.focus()), [registerComposer])
  const messageListRef = useRef<HTMLDivElement>(null)
  const shouldFollowLatestRef = useRef(true)
  const knownRunEventIdsRef = useRef<Set<string>>(new Set())
  const subscriptionRef = useRef<ReturnType<typeof createAgentRunEventSource> | null>(null)
  const loadGenerationRef = useRef(0)
  const pendingSendRef = useRef<{
    workspaceId: string
    expectedConversationId: string | undefined
    createdConversationId?: string
    invalidated: boolean
  } | null>(null)
  const callbacksRef = useRef({ onCanvasPatchApplied, onConversationUpdated })
  const drafts = useRef(new Map<string, { input: string; attachments: HarnessAttachment[]; mentions: ContextMention[] }>())
  const previousScope = useRef(scope)
  const draftSnapshot = useRef({ input, attachments, mentions })
  useLayoutEffect(() => {
    if (previousScope.current !== scope) {
      const ownCreation = pendingSendRef.current?.createdConversationId === activeConversationId
      if (!ownCreation) {
        drafts.current.set(previousScope.current, draftSnapshot.current)
        const next = drafts.current.get(scope)
        setInput(next?.input ?? ""); setAttachments(next?.attachments ?? []); setMentions(next?.mentions ?? []); setMentionQuery(null)
        attachmentOperation.current?.abort(); attachmentOperation.current = null; setAttachmentLoading(false)
      }
      previousScope.current = scope
    }
    draftSnapshot.current = { input, attachments, mentions }
  }, [scope, activeConversationId, input, attachments, mentions])
  useEffect(() => () => { attachmentOperation.current?.abort() }, [])

  const addAttachments = async (files: File[]) => {
    if (!files.length || sending) return
    if (attachmentOperation.current) { toast.info("请等待当前附件读取完成"); return }
    if (files.length + attachments.length > 6) { toast.error("每条消息最多添加 6 个附件"); return }
    const abort = new AbortController()
    attachmentOperation.current = abort; setAttachmentLoading(true)
    const results = await Promise.allSettled(files.map((file) => readChatAttachment(file, abort.signal)))
    if (attachmentOperation.current !== abort || abort.signal.aborted) return
    const ready: HarnessAttachment[] = []
    for (const result of results) {
      if (result.status === "fulfilled") ready.push(result.value)
      else toast.error(result.reason instanceof Error ? result.reason.message : "附件读取失败")
    }
    const next = [...draftSnapshot.current.attachments, ...ready]
    if (harnessAttachmentsSchema.safeParse(next).success) setAttachments(next)
    else toast.error("附件总传输大小超过 7 MB，请减少图片数量或缩小图片")
    attachmentOperation.current = null; setAttachmentLoading(false)
  }

  useEffect(() => { callbacksRef.current = { onCanvasPatchApplied, onConversationUpdated } }, [onCanvasPatchApplied, onConversationUpdated])
  useEffect(() => () => { if (pendingSendRef.current) pendingSendRef.current.invalidated = true }, [])

  const loadMessages = useCallback(async (conversationId = activeConversationId) => {
    const generation = ++loadGenerationRef.current
    if (!conversationId) {
      setMessages([])
      setRunEvents({})
      knownRunEventIdsRef.current.clear()
      return null
    }
    try {
      const [nextMessages, activeRun] = await Promise.all([
        listConversationMessages(conversationId), getConversationActiveRun(conversationId),
      ])
      const runIds = nextMessages.map((message) => message.run_id).filter((runId): runId is string => !!runId)
      const eventEntries = await Promise.all(runIds.map(async (runId) => [runId, await listAgentRunEvents(runId)] as const))
      if (generation !== loadGenerationRef.current) return null
      const eventsByRun = Object.fromEntries(eventEntries)
      setMessages(nextMessages.map((message) => {
        const deltas = message.run_id ? eventsByRun[message.run_id]?.filter((event) => event.type === "assistant_delta") : []
        return deltas?.length ? { ...message, content: deltas.map((event) => String(event.payload.delta ?? "")).join("") } : message
      }))
      knownRunEventIdsRef.current = new Set(eventEntries.flatMap(([, events]) => events.map((event) => event.id)))
      setRunEvents(Object.fromEntries(eventEntries))
      return activeRun
    } catch {
      if (generation === loadGenerationRef.current) toast.error("消息加载失败")
      return null
    }
  }, [activeConversationId])

  useEffect(() => {
    shouldFollowLatestRef.current = true
    setShowScrollToBottom(false)
  }, [activeConversationId])

  useLayoutEffect(() => {
    const messageList = messageListRef.current
    if (!messageList || !shouldFollowLatestRef.current) return
    messageList.scrollTop = messageList.scrollHeight
  }, [messages, runEvents])

  useLayoutEffect(() => {
    const composer = composerRef.current
    if (!composer) return
    if (document.activeElement === composer && getComposerPlainText(composer) === input) return
    syncComposerContent(composer, input, mentions)
  }, [input, mentions])

  const filteredMentionSources = useMemo(() => {
    if (mentionQuery === null) return []
    const query = mentionQuery.trim().toLowerCase()
    return contextSources
      .filter((source) => {
        if (!query) return true
        return [source.title, source.uri, source.description, source.summary]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(query))
      })
      .slice(0, 8)
  }, [contextSources, mentionQuery])

  const handleInputChange = useCallback((value: string, caret: number | null) => {
    setInput(value)
    setMentions((current) => current.filter((mention) => value.includes(`@${mention.label}`)))
    const beforeCaret = value.slice(0, caret ?? value.length)
    const match = /(^|\s)@([^\s@]*)$/.exec(beforeCaret)
    setMentionQuery(match ? match[2] : null)
  }, [])

  const handleMessageListScroll = useCallback((element: HTMLDivElement) => {
    const isAtBottom = isNearChatBottom(element)
    shouldFollowLatestRef.current = isAtBottom
    setShowScrollToBottom(!isAtBottom)
  }, [])

  const selectMention = useCallback((source: ContextSource) => {
    const composer = composerRef.current
    const caret = composer ? getComposerCaretOffset(composer) : input.length
    const beforeCaret = input.slice(0, caret)
    const afterCaret = input.slice(caret)
    const match = /(^|\s)@([^\s@]*)$/.exec(beforeCaret)
    const mentionText = `@${source.title}`
    const nextCaret = match
      ? beforeCaret.slice(0, match.index).length + match[1].length + mentionText.length + 1
      : beforeCaret.length + mentionText.length + 1
    const nextInput = match
      ? `${beforeCaret.slice(0, match.index)}${match[1]}${mentionText} ${afterCaret}`
      : `${beforeCaret}${mentionText} ${afterCaret}`
    setInput(nextInput)
    setMentions((current) => [
      ...current.filter((mention) => mention.context_source_id !== source.id),
      {
        context_source_id: source.id,
        type: source.type,
        label: source.title,
        uri: source.uri,
      },
    ])
    setMentionQuery(null)
    requestAnimationFrame(() => {
      const nextComposer = composerRef.current
      nextComposer?.focus()
      if (nextComposer) setComposerCaretOffset(nextComposer, nextCaret)
    })
  }, [input])

  const subscribeRun = useCallback((run: AgentRun, conversationId: string) => {
    subscriptionRef.current?.close()
    const source = createAgentRunEventSource(run.id)
    subscriptionRef.current = source
    setRunningRunId(run.id)
    setReconnecting(false)
    const close = () => {
      source.close()
      if (subscriptionRef.current !== source) return
      subscriptionRef.current = null
      setRunningRunId((current) => current === run.id ? null : current)
      setReconnecting(false)
      void loadMessages(conversationId).finally(() => {
        callbacksRef.current.onConversationUpdated?.()
      })
    }
    for (const eventType of streamedEventTypes) {
      source.addEventListener(eventType, (event) => {
        if (subscriptionRef.current !== source) return
        const parsed = JSON.parse((event as MessageEvent).data) as AgentRunEvent
        if (knownRunEventIdsRef.current.has(parsed.id)) {
          if (terminalEvents.has(parsed.type)) close()
          return
        }
        knownRunEventIdsRef.current.add(parsed.id)
        setRunEvents((current) => ({
          ...current,
          [parsed.run_id]: [...(current[parsed.run_id] ?? []), parsed],
        }))
        if (parsed.type === "assistant_delta") {
          const delta = typeof parsed.payload.delta === "string" ? parsed.payload.delta : ""
          if (delta) {
            setMessages((current) => current.map((message) => (
              message.run_id === parsed.run_id ? { ...message, content: `${message.content}${delta}` } : message
            )))
          }
        }
        if (parsed.type === "canvas_patch_applied") {
          callbacksRef.current.onCanvasPatchApplied?.(parsed)
        }
        if (terminalEvents.has(parsed.type)) close()
      })
    }
    source.addEventListener("open", () => { if (subscriptionRef.current === source) setReconnecting(false) })
    source.onerror = () => { if (subscriptionRef.current === source) setReconnecting(true) }
  }, [loadMessages])

  useEffect(() => {
    const pending = pendingSendRef.current
    if (pending) {
      if (pending.workspaceId !== workspaceId) pending.invalidated = true
      if (pending.expectedConversationId !== activeConversationId) {
        if (pending.createdConversationId !== undefined && pending.createdConversationId === activeConversationId) {
          pending.expectedConversationId = activeConversationId
          pending.createdConversationId = undefined
        } else pending.invalidated = true
      }
    }
    let disposed = false
    setRunningRunId(null)
    setReconnecting(false)
    void loadMessages().then((run) => {
      if (!disposed && run && activeConversationId) subscribeRun(run, activeConversationId)
    })
    return () => {
      disposed = true
      loadGenerationRef.current += 1
      subscriptionRef.current?.close()
      subscriptionRef.current = null
    }
  }, [workspaceId, activeConversationId, loadMessages, subscribeRun])

  const handleSend = useCallback(async () => {
    const content = input.trim() || (editorReferences?.pending.length ? "请按每处引用的修改要求处理。" : attachments.length ? "请阅读这些附件。" : "")
    if (!content || runningRunId || pendingSendRef.current || attachmentLoading || voice.phase !== "idle") return
    const pending = { workspaceId, expectedConversationId: activeConversationId, createdConversationId: undefined as string | undefined, invalidated: false }
    pendingSendRef.current = pending
    setSending(true)
    try {
      const editorPayload = await editorReferences?.getPayload()
      if (pending.invalidated) return
      let conversationId = activeConversationId
      if (!conversationId) {
        const conversation = await createWorkspaceConversation(workspaceId)
        if (pending.invalidated) return
        conversationId = conversation.id
        pending.createdConversationId = conversationId
        onConversationCreated(conversation.id)
      }
      const run = await startConversationRun({
        workspaceId,
        conversationId,
        content,
        mentions,
        ...(attachments.length ? { attachments } : {}),
        ...(editorPayload?.references.length ? { references: editorPayload.references } : {}),
        model,
        mutationMode,
        context: { document_id: workspaceId, ...(editorPayload?.snapshot ? { editor_snapshot: editorPayload.snapshot } : {}) },
      })
      if (pending.invalidated) return
      editorReferences?.consume(editorPayload?.references.map((reference) => reference.id) ?? [])
      setInput("")
      setAttachments([])
      setMentions([])
      setMentionQuery(null)
      setRunningRunId(run.id)
      await loadMessages(conversationId)
      if (pending.invalidated) return
      onConversationUpdated?.()
      subscribeRun(run, conversationId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "发送失败")
    } finally {
      setSending(false)
      if (pendingSendRef.current === pending) pendingSendRef.current = null
    }
  }, [activeConversationId, input, attachments, attachmentLoading, voice.phase, loadMessages, mentions, model, mutationMode, onConversationCreated, onConversationUpdated, runningRunId, subscribeRun, workspaceId, editorReferences])

  const handleCancelRun = useCallback(async () => {
    if (!runningRunId) return
    try {
      await cancelAgentRun(runningRunId)
    } catch {
      toast.error("停止失败")
    }
  }, [runningRunId])

  const visibleMessages = messages
  const headerTitle = activeConversationTitle?.trim() || "当前对话"

  return (
    <aside className="flex min-h-0 w-full min-w-0 flex-col border-l border-border bg-background">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        {activeConversationId ? (
          <div className="flex min-w-0 items-center gap-1">
            <p className="max-w-[15rem] truncate text-sm font-semibold" title={headerTitle}>{headerTitle}</p>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon-xs" aria-label="对话操作">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuGroup>
                  <DropdownMenuItem disabled={!onToggleConversationPinned} onSelect={onToggleConversationPinned}>
                    <Pin fill={activeConversationPinned ? "none" : "currentColor"} />
                    {activeConversationPinned ? "取消置顶对话" : "置顶对话"}
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={!onRenameConversation} onSelect={onRenameConversation}>
                    <SquarePen />
                    重命名对话
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : <div />}
        <div className="flex items-center gap-2">
          {reconnecting ? <span role="status" className="text-xs text-muted-foreground">连接中断，正在重连</span> : null}
          {runningRunId ? <span className="size-2 rounded-full bg-sky-500" /> : null}
          {onHide ? (
            <Button type="button" variant="ghost" size="icon-sm" aria-label="隐藏 AI 面板" onClick={onHide}>
              <PanelRight data-icon-name="panel-right" />
            </Button>
          ) : null}
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          ref={messageListRef}
          data-testid="agent-chat-messages"
          className="h-full space-y-5 overflow-y-auto px-4 py-4"
          onScroll={(event) => handleMessageListScroll(event.currentTarget)}
        >
          {visibleMessages.length === 0 ? (
            <EmptyChatState onPrompt={(prompt) => setInput(prompt)} />
          ) : visibleMessages.map((message) => (
            <ChatMessage
              key={message.id}
              message={message}
              events={message.run_id ? runEvents[message.run_id] ?? [] : []}
              expanded={!!message.run_id && expandedRuns.has(message.run_id)}
              onToggleExpanded={() => {
                if (!message.run_id) return
                setExpandedRuns((current) => {
                  const next = new Set(current)
                  if (next.has(message.run_id!)) next.delete(message.run_id!)
                  else next.add(message.run_id!)
                  return next
                })
              }}
            />
          ))}
        </div>
        {showScrollToBottom ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="回到底部"
            title="回到底部"
            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-background shadow-md"
            onClick={() => {
              const messageList = messageListRef.current
              messageList?.scrollTo({ top: messageList.scrollHeight, behavior: "smooth" })
            }}
          >
            <ChevronDown data-icon="inline-start" />
          </Button>
        ) : null}
      </div>

      <div data-testid="agent-chat-composer-region" className="shrink-0 p-3">
        <div className="rounded-2xl border border-border bg-background shadow-sm"
          onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault() }}
          onDrop={(event) => { if (event.dataTransfer.files.length) { event.preventDefault(); void addAttachments(Array.from(event.dataTransfer.files)) } }}>
          <ReferenceComposer />
          {attachments.length ? <div className="max-h-56 overflow-y-auto px-3 pt-3"><ChatAttachments attachments={attachments} disabled={sending} onRemove={(id) => setAttachments((current) => current.filter((attachment) => attachment.id !== id))} /></div> : null}
          {attachmentLoading ? <div role="status" className="flex items-center gap-2 px-3 pt-3 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" />正在读取附件<Button variant="ghost" size="icon-xs" aria-label="取消读取附件" onClick={() => { attachmentOperation.current?.abort(); attachmentOperation.current = null; setAttachmentLoading(false) }}><X /></Button></div> : null}
          <div className="relative min-h-24">
            <div
              ref={composerRef}
              role="textbox"
              aria-label="AI 输入"
              aria-multiline="true"
              contentEditable={!sending}
              suppressContentEditableWarning
              data-placeholder="随心输入"
              className="block max-h-60 min-h-24 w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent px-3 pt-3 text-sm leading-6 text-foreground caret-foreground outline-none empty:before:pointer-events-none empty:before:text-muted-foreground/50 empty:before:content-[attr(data-placeholder)]"
              onInput={(event) => {
                const composer = event.currentTarget
                handleInputChange(getComposerPlainText(composer), getComposerCaretOffset(composer))
              }}
              onClick={(event) => handleInputChange(input, getComposerCaretOffset(event.currentTarget))}
              onKeyUp={(event) => handleInputChange(input, getComposerCaretOffset(event.currentTarget))}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  void handleSend()
                }
              }}
              onPaste={(event) => {
                const files = Array.from(event.clipboardData.files)
                event.preventDefault()
                if (files.length) { void addAttachments(files); return }
                const text = event.clipboardData.getData("text/plain")
                const selection = window.getSelection()
                if (!selection?.rangeCount || !event.currentTarget.contains(selection.anchorNode)) return
                const range = selection.getRangeAt(0)
                range.deleteContents()
                const node = document.createTextNode(text)
                range.insertNode(node); range.setStartAfter(node); range.collapse(true)
                selection.removeAllRanges(); selection.addRange(range)
                handleInputChange(getComposerPlainText(event.currentTarget), getComposerCaretOffset(event.currentTarget))
              }}
            />
            {mentionQuery !== null && filteredMentionSources.length > 0 ? (
              <div className="absolute bottom-full left-2 right-2 z-20 mb-2 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-lg">
                {filteredMentionSources.map((source) => (
                  <button
                    key={source.id}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectMention(source)}
                  >
                    <MentionIcon source={source} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{source.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">{source.type === "webpage" ? source.uri : source.uri.replace("file:///", "")}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {voice.error ? <p role="alert" className="max-h-24 overflow-y-auto break-words px-3 pt-2 text-xs leading-5 text-destructive">{voice.error}；录音保留在内存中，可重试转写或取消。</p> : null}
          {voice.phase !== "idle" ? <div className="flex h-11 items-center gap-2 px-3">
            <Button variant="ghost" size="icon-sm" aria-label="取消录音或转写" onClick={voice.cancel}><X /></Button>
            {voice.phase === "recording" ? <div role="status" aria-label="正在录音" className="flex h-7 min-w-0 flex-1 items-center justify-end gap-1 overflow-hidden">
              {Array.from({ length: 60 }, (_, index) => <span key={index} className="w-0.5 shrink-0 rounded-full bg-muted-foreground/60" style={{ height: `${3 + (voice.levels[index - (60 - voice.levels.length)] ?? 0) * 23}px` }} />)}
            </div> : <span role="status" className="flex-1 text-center text-xs text-muted-foreground">{voice.phase === "starting" ? "正在打开麦克风" : voice.phase === "failed" ? "转写失败" : "正在转写"}</span>}
            {voice.phase === "recording" ? <Button variant="secondary" size="icon-sm" aria-label="停止录音并转写" onClick={() => void voice.stop()}><Square className="fill-current" /></Button>
              : voice.phase === "failed" ? <Button variant="secondary" size="sm" onClick={() => void voice.retry()}>重试转写</Button>
                : <Loader2 className="mx-2 size-4 animate-spin text-muted-foreground" />}
            <Button size="icon-sm" className="rounded-full" disabled aria-label="转写完成后发送"><ArrowUp /></Button>
          </div> : null}
          <div className={cn("flex h-11 min-w-0 items-center gap-2 px-3", voice.phase !== "idle" && "hidden")}>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <input ref={attachmentPicker} type="file" multiple accept={attachmentAccept} className="hidden" aria-label="选择聊天附件" onChange={(event) => { void addAttachments(Array.from(event.target.files ?? [])); event.target.value = "" }} />
              <Button variant="ghost" size="icon-sm" aria-label="添加" title="添加图片或文件" disabled={sending || attachmentLoading} onClick={() => attachmentPicker.current?.click()}>
                <Plus className="size-4" />
              </Button>
              <MutationModeMenu value={mutationMode} onChange={setMutationMode} />
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button variant="ghost" size="sm" className="h-8 max-w-32 px-2 text-xs">
                <span className="truncate">模型 {model ?? "默认"}</span>
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="语音输入" title="语音输入" disabled={sending} onClick={() => void voice.start()}>
                <Mic className="size-4" />
              </Button>
              <Button
                size="icon-sm"
                aria-label={runningRunId ? "停止" : "发送"}
                title={runningRunId ? "停止" : "发送"}
                className={cn(
                  "size-8 rounded-full bg-neutral-900 text-white hover:bg-neutral-800 disabled:bg-muted-foreground/60 disabled:text-white disabled:opacity-100",
                  runningRunId && "hover:bg-neutral-900",
                )}
                onClick={() => {
                  if (runningRunId) {
                    void handleCancelRun()
                    return
                  }
                  void handleSend()
                }}
                disabled={!runningRunId && (sending || attachmentLoading || voice.phase !== "idle" || (!input.trim() && !editorReferences?.pending.length && !attachments.length))}
              >
                {runningRunId ? <Square className="size-3.5 fill-current" /> : <ArrowUp className="size-5" />}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}

function useAssistantUiShellRuntime() {
  const adapter = useMemo<ChatModelAdapter>(() => ({
    async run() {
      return { content: [] }
    },
  }), [])
  return useLocalRuntime(adapter)
}

function EmptyChatState({ onPrompt }: { onPrompt: (prompt: string) => void }) {
  const prompts = ["检查这份简历质量", "根据岗位链接优化", "帮我改写专业技能"]
  return (
    <div className="flex min-h-full flex-col justify-center gap-3 py-8">
      <div className="text-center">
        <WandSparkles className="mx-auto mb-3 size-5 text-muted-foreground" />
        <p className="text-sm font-medium">从当前画布开始</p>
      </div>
      <div className="space-y-2">
        {prompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            className="w-full rounded-md border border-border px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
            onClick={() => onPrompt(prompt)}
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  )
}

function ChatMessage({
  message,
  events,
  expanded,
  onToggleExpanded,
}: {
  message: AgentMessage
  events: AgentRunEvent[]
  expanded: boolean
  onToggleExpanded: () => void
}) {
  const isAssistant = message.role === "assistant"
  const orderedEvents = useMemo(() => [...events].sort((a, b) => a.sequence - b.sequence), [events])
  const terminal = orderedEvents.find((event) => terminalEvents.has(event.type))
  const startedAt = orderedEvents[0]?.created_at ?? message.created_at
  const elapsedMs = useElapsedMs(startedAt, terminal?.created_at)
  const duration = formatDuration(elapsedMs)
  const statusLabel = terminal ? getRunStatusLabel(terminal, message) : getInProgressRunStatusLabel(orderedEvents)
  const traceItems = useMemo(() => buildRunTraceItems(orderedEvents, { includeRawThinking: !terminal }), [orderedEvents, terminal])
  const showTraceToggle = isAssistant && !!message.run_id && statusLabel !== null
  const traceOpen = showTraceToggle && expanded
  const hasConclusion = isAssistant && message.content.trim().length > 0
  const failure = terminal?.type === "run_failed" ? getRecordString(terminal.payload.error, "message") : undefined
  const requests = useMemo(() => editorRequests(orderedEvents), [orderedEvents])

  return (
    <article data-agent-message-id={message.id} className={cn("space-y-3", message.role === "user" && "rounded-lg bg-muted/60 p-3")}>
      <MessageReferences references={message.references} />
      <ChatAttachments attachments={message.attachments ?? []} />
      {failure ? <p role="alert" className="break-words text-sm leading-6 text-destructive">{failure}</p> : null}
      {showTraceToggle ? (
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-muted-foreground"
          onClick={onToggleExpanded}
          aria-expanded={traceOpen}
        >
          <span>{statusLabel}{duration ? ` ${duration}` : ""}</span>
          {traceOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </button>
      ) : null}

      {traceOpen ? (
        <div className="space-y-3 border-b border-border pb-4 text-sm leading-7 text-foreground">
          {traceItems.length > 0 ? traceItems.map((item) => (
            <RunTraceItemView key={item.id} item={item} />
          )) : (
            <p className="text-muted-foreground">{terminal ? RUN_TRACE_COPY.emptyCompletedTrace : RUN_TRACE_COPY.preparingContext}</p>
          )}
        </div>
      ) : null}

      <div className="max-w-none">
        {message.role === "user" ? (
          <p className="m-0 whitespace-pre-wrap text-sm leading-6">
            <HighlightedMessageText text={message.content} mentions={message.mentions} />
          </p>
        ) : (
          <MessageReferenceSelection messageId={message.id}>
            {hasConclusion ? <p className="mb-2 text-sm font-semibold text-foreground">结论</p> : null}
            <ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} components={assistantMarkdownComponents}>
              {message.content}
            </ReactMarkdown>
          </MessageReferenceSelection>
        )}
      </div>
      {message.run_id ? requests.map((request) => <EditorRequestCard key={request.id} request={request} runId={message.run_id!} events={orderedEvents} active={!terminal} />) : null}
    </article>
  )
}

type RunTraceItem =
  | {
      id: string;
      kind: "thinking";
      text: string;
    }
  | {
      id: string;
      kind: "tool";
      label: string;
      detail?: string;
      durationMs?: number;
      status: "running" | "completed" | "failed";
    }
  | {
      id: string;
      kind: "event";
      label: string;
      detail?: string;
    };

function RunTraceItemView({ item }: { item: RunTraceItem }) {
  if (item.kind === "thinking") {
    return (
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">{RUN_TRACE_COPY.thinkingHeading}</p>
        <p className="whitespace-pre-wrap rounded-md border border-border bg-muted/40 px-3 py-2 text-sm leading-6 text-muted-foreground">{item.text}</p>
      </div>
    )
  }

  if (item.kind === "tool") {
    return (
      <div className="space-y-1 text-muted-foreground">
        <p>
          {item.status === "running" ? "正在运行" : "已运行"} <code className="rounded bg-muted px-1 py-0.5 text-[0.85em] text-foreground">{item.label}</code>
          {item.durationMs !== undefined ? `，已持续 ${formatDuration(item.durationMs)}` : ""}
        </p>
        {item.detail ? <p className="break-words text-xs leading-5">{item.detail}</p> : null}
      </div>
    )
  }

  return (
    <div className="space-y-1 text-muted-foreground">
      <p>{item.label}</p>
      {item.detail ? <p className="break-words text-xs leading-5">{item.detail}</p> : null}
    </div>
  )
}

function useElapsedMs(startedAt: string, completedAt?: string): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (completedAt) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [completedAt])

  const start = Date.parse(startedAt)
  const end = completedAt ? Date.parse(completedAt) : now
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  return Math.max(0, end - start)
}

function buildRunTraceItems(events: AgentRunEvent[], options: { includeRawThinking: boolean }): RunTraceItem[] {
  const items: RunTraceItem[] = []
  const toolStarts = new Map<string, AgentRunEvent>()
  let thinkingItem: Extract<RunTraceItem, { kind: "thinking" }> | undefined
  let summarizedThinking = false

  for (const event of events) {
    if (event.type === "thinking_delta") {
      const text = String(event.payload.delta ?? "")
      if (text && options.includeRawThinking) {
        if (thinkingItem) {
          thinkingItem.text += text
        } else {
          thinkingItem = {
            id: event.id,
            kind: "thinking",
            text,
          }
          items.push(thinkingItem)
        }
      } else if (text && !summarizedThinking) {
        items.push({
          id: event.id,
          kind: "event",
          label: RUN_TRACE_COPY.reasoningSummaryStep,
        })
        summarizedThinking = true
      }
      continue
    }

    thinkingItem = undefined

    if (event.type === "tool_call_started") {
      const toolCall = event.payload.tool_call
      const toolCallId = getRecordString(toolCall, "id") || event.id
      toolStarts.set(toolCallId, event)
      items.push({
        id: event.id,
        kind: "tool",
        label: toolLabel(getRecordString(toolCall, "name")),
        detail: summarizeRecord(getRecord(toolCall, "input")),
        status: "running",
      })
      continue
    }

    if (event.type === "tool_call_completed" || event.type === "tool_call_failed") {
      const result = getRecord(event.payload.result)
      const toolCallId = getRecordString(result, "tool_call_id")
      const start = toolCallId ? toolStarts.get(toolCallId) : undefined
      const startedTool = getRecord(start?.payload.tool_call)
      const status = getRecordString(result, "status") === "failed" || event.type === "tool_call_failed" ? "failed" : "completed"
      const completedItem: RunTraceItem = {
        id: start?.id ?? event.id,
        kind: "tool",
        label: toolLabel(getRecordString(startedTool, "name") || toolCallId),
        detail: summarizeToolResult(result),
        durationMs: start ? Date.parse(event.created_at) - Date.parse(start.created_at) : undefined,
        status,
      }
      const existingIndex = start ? items.findIndex((item) => item.id === start.id) : -1
      if (existingIndex >= 0) {
        items[existingIndex] = completedItem
      } else {
        items.push(completedItem)
      }
      continue
    }

    if (event.type === "canvas_patch_proposed") {
      items.push({
        id: event.id,
        kind: "event",
        label: "已生成修改建议",
        detail: String(event.payload.summary ?? ""),
      })
      continue
    }

    if (event.type === "canvas_patch_applied") {
      items.push({
        id: event.id,
        kind: "event",
        label: "已更新画布",
      })
    }
  }

  return items
}

function MutationModeMenu({
  value,
  onChange,
}: {
  value: CanvasMutationMode
  onChange: (value: CanvasMutationMode) => void
}) {
  const handleChange = (nextValue: CanvasMutationMode) => {
    if (nextValue === "solo" && value !== "solo") {
      const confirmed = window.confirm("允许 AI 自动修改当前画布？上下文文件、文件夹和网页链接始终只读。")
      if (!confirmed) return
    }
    onChange(nextValue)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs">
          <ShieldCheck className="size-3.5" />
          {mutationModeLabels[value]}
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <ModeItem
          active={value === "suggest"}
          title="建议模式"
          description="只分析和给出建议，不修改画布"
          onSelect={() => handleChange("suggest")}
        />
        <ModeItem
          active={value === "review"}
          title="手动应用"
          description="生成修改后由你确认应用"
          onSelect={() => handleChange("review")}
        />
        <ModeItem
          active={value === "solo"}
          title="自动修改"
          description="允许 AI 直接修改当前画布"
          onSelect={() => handleChange("solo")}
        />
        <p className="px-2 py-1.5 text-xs leading-5 text-muted-foreground">本地文件、文件夹和网页链接始终只读。</p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ModeItem({
  active,
  title,
  description,
  onSelect,
}: {
  active: boolean
  title: string
  description: string
  onSelect: () => void
}) {
  return (
    <DropdownMenuItem className="items-start gap-2" onSelect={onSelect}>
      <span className={cn("mt-1 size-2 rounded-full", active ? "bg-primary" : "bg-transparent")} />
      <span>
        <span className="block text-sm">{title}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
    </DropdownMenuItem>
  )
}

function HighlightedMessageText({ text, mentions }: { text: string; mentions: ContextMention[] }) {
  if (mentions.length === 0) return <>{text}</>
  const mentionLabels = [...new Set(mentions.map((mention) => mention.label).filter(Boolean))]
  const pattern = new RegExp(`(@(?:${mentionLabels.map(escapeRegExp).join("|")}))`, "g")
  return text.split(pattern).map((part, index) => {
    const mention = mentions.find((item) => part === `@${item.label}`)
    if (!mention) return <span key={`${part}-${index}`}>{part}</span>
    return (
      <span key={`${part}-${index}`} title={mention.uri} className="inline-flex rounded-md bg-primary/10 px-1.5 py-0.5 text-primary">
        {part}
      </span>
    )
  })
}

function syncComposerContent(root: HTMLElement, text: string, mentions: ContextMention[]): void {
  root.replaceChildren(...createComposerNodes(text, mentions))
}

function createComposerNodes(text: string, mentions: ContextMention[]): Node[] {
  if (!text) return []
  if (mentions.length === 0) return [document.createTextNode(text)]

  const mentionLabels = [...new Set(mentions.map((mention) => mention.label).filter(Boolean))]
  if (mentionLabels.length === 0) return [document.createTextNode(text)]

  const pattern = new RegExp(`(@(?:${mentionLabels.map(escapeRegExp).join("|")}))`, "g")
  return text.split(pattern).filter(Boolean).map((part) => {
    const mention = mentions.find((item) => part === `@${item.label}`)
    return mention ? createMentionToken(mention) : document.createTextNode(part)
  })
}

function createMentionToken(mention: ContextMention): HTMLElement {
  const token = document.createElement("span")
  token.dataset.mentionToken = "true"
  token.dataset.mentionLabel = mention.label
  token.title = mention.uri ?? ""
  token.contentEditable = "false"
  token.className = "mx-0.5 inline-flex select-none items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 align-baseline font-medium text-primary"

  const icon = document.createElement("span")
  icon.setAttribute("aria-hidden", "true")
  icon.className = "inline-flex size-3.5 shrink-0 items-center justify-center rounded-[3px] bg-primary text-primary-foreground"
  icon.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 2.5h4l2 2V13H5z"/><path d="M9 2.5v2h2"/><path d="M6.5 7h3"/><path d="M6.5 9.5h3"/></svg>'

  const label = document.createElement("span")
  label.textContent = mention.label

  token.append(icon, label)
  return token
}

function getComposerPlainText(root: HTMLElement): string {
  let text = ""

  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? ""
      return
    }

    if (!(node instanceof HTMLElement)) return
    if (node.dataset.mentionToken === "true") {
      text += `@${node.dataset.mentionLabel ?? ""}`
      return
    }
    if (node.tagName === "BR") {
      text += "\n"
      return
    }
    node.childNodes.forEach(visit)
  }

  root.childNodes.forEach(visit)
  return text
}

function getComposerCaretOffset(root: HTMLElement): number {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return getComposerPlainText(root).length

  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer)) return getComposerPlainText(root).length

  let offset = 0
  let found = false

  const nodeTextLength = (node: Node): number => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0
    if (!(node instanceof HTMLElement)) return 0
    if (node.dataset.mentionToken === "true") return `@${node.dataset.mentionLabel ?? ""}`.length
    if (node.tagName === "BR") return 1
    return Array.from(node.childNodes).reduce((sum, child) => sum + nodeTextLength(child), 0)
  }

  const visit = (node: Node): boolean => {
    if (node === range.startContainer) {
      if (node.nodeType === Node.TEXT_NODE) {
        offset += range.startOffset
        found = true
        return true
      }
      if (node instanceof HTMLElement) {
        for (let index = 0; index < range.startOffset; index += 1) {
          const child = node.childNodes[index]
          if (child) offset += nodeTextLength(child)
        }
        found = true
        return true
      }
    }

    if (node.nodeType === Node.TEXT_NODE) {
      offset += node.textContent?.length ?? 0
      return false
    }
    if (!(node instanceof HTMLElement)) return false
    if (node.dataset.mentionToken === "true") {
      offset += `@${node.dataset.mentionLabel ?? ""}`.length
      return false
    }
    if (node.tagName === "BR") {
      offset += 1
      return false
    }
    for (const child of Array.from(node.childNodes)) {
      if (visit(child)) return true
    }
    return false
  }

  for (const child of Array.from(root.childNodes)) {
    if (visit(child)) break
  }
  return found ? offset : getComposerPlainText(root).length
}

function setComposerCaretOffset(root: HTMLElement, targetOffset: number): void {
  const selection = window.getSelection()
  if (!selection) return

  const range = document.createRange()
  let remaining = Math.max(0, targetOffset)
  let placed = false

  const place = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent?.length ?? 0
      if (remaining <= length) {
        range.setStart(node, remaining)
        placed = true
        return true
      }
      remaining -= length
      return false
    }

    if (!(node instanceof HTMLElement)) return false
    if (node.dataset.mentionToken === "true") {
      const length = `@${node.dataset.mentionLabel ?? ""}`.length
      if (remaining <= length) {
        range.setStartAfter(node)
        placed = true
        return true
      }
      remaining -= length
      return false
    }
    if (node.tagName === "BR") {
      if (remaining <= 1) {
        range.setStartAfter(node)
        placed = true
        return true
      }
      remaining -= 1
      return false
    }
    for (const child of Array.from(node.childNodes)) {
      if (place(child)) return true
    }
    return false
  }

  for (const child of Array.from(root.childNodes)) {
    if (place(child)) break
  }

  if (!placed) {
    range.selectNodeContents(root)
    range.collapse(false)
  }

  selection.removeAllRanges()
  selection.addRange(range)
}

function MentionIcon({ source }: { source: ContextSource }) {
  if (source.type === "webpage" && source.favicon_url) {
    return <img src={source.favicon_url} alt="" className="size-4 rounded-sm" />
  }
  return <span className="size-2 rounded-full bg-primary/70" />
}

function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 1000) return "0s"
  const totalSeconds = Math.floor(durationMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes <= 0) return `${seconds}s`
  return `${minutes}m ${seconds}s`
}

function getRecord(value: unknown, key?: string): Record<string, unknown> | undefined {
  const target = key && value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : value
  return target && typeof target === "object" && !Array.isArray(target)
    ? target as Record<string, unknown>
    : undefined
}

function getRecordString(value: unknown, key: string): string | undefined {
  const record = getRecord(value)
  const next = record?.[key]
  return typeof next === "string" && next.trim() ? next : undefined
}

function summarizeToolResult(result: Record<string, unknown> | undefined): string | undefined {
  if (!result) return undefined
  const error = getRecord(result.error)
  if (error) {
    return getRecordString(error, "message") ?? "工具调用失败"
  }
  const output = getRecord(result.output)
  if (output?.kind === "canvas_pages" && Array.isArray(output.pages)) {
    return `已查看第 ${output.pages.map((page) => getRecord(page)?.page).join("、")} 页，共 ${output.page_count} 页`
  }
  if (output?.kind === "resume_text") return `已读取 ${typeof output.text === "string" ? output.text.length : 0} 字`
  return summarizeRecord(result.output)
}

function toolLabel(name: string | undefined): string {
  const labels: Record<string, string> = { "resume.read": "读取简历内容", "resume.view_pages": "查看简历页面", "resume.capabilities": "查询编辑能力", "resume.inspect": "读取当前画布结构", "resume.edit": "编辑简历" }
  return (name && labels[name]) || name || "工具"
}

function summarizeRecord(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === "string") return value.length > 180 ? `${value.slice(0, 180)}...` : value
  try {
    const text = JSON.stringify(value)
    return text.length > 180 ? `${text.slice(0, 180)}...` : text
  } catch {
    return undefined
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
