import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter } from "@assistant-ui/react"
import { ArrowUp, ChevronDown, ChevronRight, Mic, Plus, ShieldCheck, Square, WandSparkles } from "lucide-react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import {
  cancelAgentRun,
  createWorkspaceConversation,
  createAgentRunEventSource,
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
  contextSources: ContextSource[]
  onConversationCreated: (conversationId: string) => void
  onCanvasPatchApplied?: (event: AgentRunEvent) => void
}

const mutationModeLabels: Record<CanvasMutationMode, string> = {
  suggest: "建议模式",
  review: "手动应用",
  solo: "自动修改",
}
const defaultAgentModel = import.meta.env.VITE_DEFAULT_AGENT_MODEL ?? "deepseek-v4-flash"

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
  "run_completed",
  "run_failed",
  "run_cancelled",
  "harness_event",
]

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
  contextSources,
  onConversationCreated,
  onCanvasPatchApplied,
}: AgentChatPanelProps) {
  const runtime = useAssistantUiShellRuntime()
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AgentChatContent
        workspaceId={workspaceId}
        activeConversationId={activeConversationId}
        contextSources={contextSources}
        onConversationCreated={onConversationCreated}
        onCanvasPatchApplied={onCanvasPatchApplied}
      />
    </AssistantRuntimeProvider>
  )
}

function AgentChatContent({
  workspaceId,
  activeConversationId,
  contextSources,
  onConversationCreated,
  onCanvasPatchApplied,
}: AgentChatPanelProps) {
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [runEvents, setRunEvents] = useState<Record<string, AgentRunEvent[]>>({})
  const [runningRunId, setRunningRunId] = useState<string | null>(null)
  const [input, setInput] = useState("")
  const [mentions, setMentions] = useState<ContextMention[]>([])
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mutationMode, setMutationMode] = useState<CanvasMutationMode>("review")
  const [model] = useState(defaultAgentModel)
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(() => new Set())
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const loadMessages = useCallback(async (conversationId = activeConversationId) => {
    if (!conversationId) {
      setMessages([])
      setRunEvents({})
      return
    }
    try {
      const nextMessages = await listConversationMessages(conversationId)
      setMessages(nextMessages)
      const runIds = nextMessages.map((message) => message.run_id).filter((runId): runId is string => !!runId)
      const eventEntries = await Promise.all(runIds.map(async (runId) => [runId, await listAgentRunEvents(runId)] as const))
      setRunEvents(Object.fromEntries(eventEntries))
    } catch {
      toast.error("消息加载失败")
    }
  }, [activeConversationId])

  useEffect(() => {
    void loadMessages()
  }, [loadMessages])

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
    const beforeCaret = value.slice(0, caret ?? value.length)
    const match = /(^|\s)@([^\s@]*)$/.exec(beforeCaret)
    setMentionQuery(match ? match[2] : null)
  }, [])

  const selectMention = useCallback((source: ContextSource) => {
    const textarea = inputRef.current
    const caret = textarea?.selectionStart ?? input.length
    const beforeCaret = input.slice(0, caret)
    const afterCaret = input.slice(caret)
    const match = /(^|\s)@([^\s@]*)$/.exec(beforeCaret)
    const mentionText = `@${source.title}`
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
      inputRef.current?.focus()
    })
  }, [input])

  const subscribeRun = useCallback((run: AgentRun, conversationId: string) => {
    const source = createAgentRunEventSource(run.id)
    const close = () => {
      source.close()
      setRunningRunId((current) => current === run.id ? null : current)
      void loadMessages(conversationId)
    }
    for (const eventType of streamedEventTypes) {
      source.addEventListener(eventType, (event) => {
        const parsed = JSON.parse((event as MessageEvent).data) as AgentRunEvent
        setRunEvents((current) => ({
          ...current,
          [parsed.run_id]: [...(current[parsed.run_id] ?? []), parsed],
        }))
        if (parsed.type === "canvas_patch_applied") {
          onCanvasPatchApplied?.(parsed)
        }
        if (terminalEvents.has(parsed.type)) close()
      })
    }
    source.onerror = close
  }, [loadMessages, onCanvasPatchApplied])

  const handleSend = useCallback(async () => {
    const content = input.trim()
    if (!content || runningRunId) return
    try {
      let conversationId = activeConversationId
      if (!conversationId) {
        const conversation = await createWorkspaceConversation(workspaceId)
        conversationId = conversation.id
        onConversationCreated(conversation.id)
      }
      const run = await startConversationRun({
        workspaceId,
        conversationId,
        content,
        mentions,
        model,
        mutationMode,
        context: { document_id: workspaceId },
      })
      setInput("")
      setMentions([])
      setMentionQuery(null)
      setRunningRunId(run.id)
      await loadMessages(conversationId)
      subscribeRun(run, conversationId)
    } catch {
      toast.error("发送失败")
    }
  }, [activeConversationId, input, loadMessages, mentions, model, mutationMode, onConversationCreated, runningRunId, subscribeRun, workspaceId])

  const handleCancelRun = useCallback(async () => {
    if (!runningRunId) return
    try {
      await cancelAgentRun(runningRunId)
    } catch {
      toast.error("停止失败")
    }
  }, [runningRunId])

  const visibleMessages = messages

  return (
    <aside className="flex min-h-0 w-[24rem] shrink-0 flex-col border-l border-border bg-background">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <div>
          <p className="text-sm font-semibold">AI 助手</p>
          <p className="text-xs text-muted-foreground">{activeConversationId ? "当前对话" : "未选择对话"}</p>
        </div>
        {runningRunId ? <span className="size-2 rounded-full bg-sky-500" /> : null}
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
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

      <div className="shrink-0 border-t border-border p-3">
        <div className="rounded-2xl border border-border bg-background shadow-sm">
          <div className="relative min-h-24 px-3 pt-3">
            <div className="pointer-events-none whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
              <HighlightedComposerText text={input} mentions={mentions} />
            </div>
            <textarea
              ref={inputRef}
              aria-label="AI 输入"
              value={input}
              className="absolute inset-0 h-full w-full resize-none bg-transparent px-3 pt-3 text-sm leading-6 text-transparent caret-foreground outline-none"
              onChange={(event) => handleInputChange(event.target.value, event.currentTarget.selectionStart)}
              onClick={(event) => handleInputChange(event.currentTarget.value, event.currentTarget.selectionStart)}
              onKeyUp={(event) => handleInputChange(event.currentTarget.value, event.currentTarget.selectionStart)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  void handleSend()
                }
              }}
            />
            {mentionQuery !== null && filteredMentionSources.length > 0 ? (
              <div className="absolute bottom-full left-2 right-2 z-20 mb-2 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-lg">
                {filteredMentionSources.map((source) => (
                  <button
                    key={source.id}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
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

          <div className="flex h-11 min-w-0 items-center gap-2 px-3">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Button variant="ghost" size="icon-sm" aria-label="添加" title="添加">
                <Plus className="size-4" />
              </Button>
              <MutationModeMenu value={mutationMode} onChange={setMutationMode} />
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button variant="ghost" size="sm" className="h-8 max-w-32 px-2 text-xs">
                <span className="truncate">模型 {model}</span>
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="语音输入暂未支持" title="语音输入暂未支持" disabled>
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
                disabled={!runningRunId && !input.trim()}
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
  const terminal = events.find((event) => terminalEvents.has(event.type))
  const thinkingText = events.filter((event) => event.type === "thinking_delta").map((event) => String(event.payload.delta ?? "")).join("")
  const toolEvents = events.filter((event) => event.type.startsWith("tool_call") || event.type.startsWith("canvas_patch"))
  const duration = terminal && events[0] ? formatDuration(Date.parse(terminal.created_at) - Date.parse(events[0].created_at)) : null

  return (
    <article className={cn("space-y-2", message.role === "user" && "rounded-lg bg-muted/60 p-3")}>
      {isAssistant && message.run_id ? (
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-muted-foreground"
          onClick={onToggleExpanded}
        >
          {terminal ? (
            <>
              已处理 {duration ?? ""}
              {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            </>
          ) : (
            <span className="animate-pulse">正在思考</span>
          )}
        </button>
      ) : null}

      {expanded ? (
        <div className="space-y-2 rounded-md border border-border/70 bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
          {thinkingText ? <p>{thinkingText}</p> : null}
          {toolEvents.map((event) => (
            <p key={event.id}>{toolEventLabel(event)}</p>
          ))}
        </div>
      ) : null}

      <div className="max-w-none">
        {message.role === "user" ? (
          <p className="m-0 whitespace-pre-wrap text-sm leading-6">
            <HighlightedMessageText text={message.content} mentions={message.mentions} />
          </p>
        ) : (
          <ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} components={assistantMarkdownComponents}>
            {message.content}
          </ReactMarkdown>
        )}
      </div>
    </article>
  )
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

function HighlightedComposerText({ text, mentions }: { text: string; mentions: ContextMention[] }) {
  if (!text) return <span className="text-muted-foreground/50">随心输入</span>
  return <HighlightedMessageText text={text} mentions={mentions} />
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

function MentionIcon({ source }: { source: ContextSource }) {
  if (source.type === "webpage" && source.favicon_url) {
    return <img src={source.favicon_url} alt="" className="size-4 rounded-sm" />
  }
  return <span className="size-2 rounded-full bg-primary/70" />
}

function toolEventLabel(event: AgentRunEvent): string {
  if (event.type === "tool_call_started") return "已开始工具调用"
  if (event.type === "tool_call_completed") return "已完成工具调用"
  if (event.type === "canvas_patch_proposed") return `已生成修改建议：${String(event.payload.summary ?? "")}`
  if (event.type === "canvas_patch_applied") return "已更新画布"
  return event.type
}

function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 1000) return ""
  return `${Math.round(durationMs / 1000)}s`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
