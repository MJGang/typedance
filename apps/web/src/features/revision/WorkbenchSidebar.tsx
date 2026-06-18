import { useCallback, useEffect, useState, type ComponentType } from "react"
import {
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  LinkIcon,
  Loader2,
  MessageSquarePlus,
  MoreHorizontal,
  Pin,
  Plug,
  Plus,
  Settings,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  addDirectoryContextSource,
  addFileContextSource,
  addWebpageContextSource,
  listContextSourceChildren,
  listContextSources,
  openContextSource,
  openContextSourceChild,
  refreshContextSource,
  removeContextSource,
  revealContextSource,
  revealContextSourceChild,
  updateContextSourceTitle,
} from "@/api"
import {
  createWorkspaceConversation,
  deleteWorkspaceConversation,
  listWorkspaceConversations,
  listWorkspacePlugins,
  updateWorkspaceConversation,
} from "@/agentHost"
import { chooseContextDirectoryPathInTauri, chooseContextFilePathsInTauri, isTauri } from "@/tauri"
import type { AgentConversation, AgentPluginSummary, ContextSource, ContextSourceChild } from "@typedance/contracts"

const defaultAgentModel = import.meta.env.VITE_DEFAULT_AGENT_MODEL?.trim() ?? ""

type WorkbenchSidebarProps = {
  workspaceId: string
  activeConversationId?: string
  conversationRefreshToken?: number
  onSelectConversation: (conversationId: string) => void
  onContextSourcesChange: (sources: ContextSource[]) => void
  onConversationsChange?: (conversations: AgentConversation[]) => void
}

type DirectoryNodeProps = {
  sourceId: string
  child: ContextSourceChild
  depth: number
}

export function WorkbenchSidebar({
  workspaceId,
  activeConversationId,
  conversationRefreshToken = 0,
  onSelectConversation,
  onContextSourcesChange,
  onConversationsChange,
}: WorkbenchSidebarProps) {
  const [contextSources, setContextSources] = useState<ContextSource[]>([])
  const [conversations, setConversations] = useState<AgentConversation[]>([])
  const [plugins, setPlugins] = useState<AgentPluginSummary[]>([])
  const [loadingContext, setLoadingContext] = useState(false)
  const [loadingConversations, setLoadingConversations] = useState(false)
  const [webDialogOpen, setWebDialogOpen] = useState(false)
  const [webUrl, setWebUrl] = useState("")
  const [pluginDialogOpen, setPluginDialogOpen] = useState(false)
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false)
  const [renamingConversation, setRenamingConversation] = useState<AgentConversation | null>(null)
  const [renameDraft, setRenameDraft] = useState("")
  const [savingConversationName, setSavingConversationName] = useState(false)
  const [addingWebpage, setAddingWebpage] = useState(false)
  const loadContextSources = useCallback(async () => {
    setLoadingContext(true)
    try {
      const nextSources = await listContextSources(workspaceId)
      setContextSources(nextSources)
      onContextSourcesChange(nextSources)
    } catch {
      toast.error("上下文加载失败")
    } finally {
      setLoadingContext(false)
    }
  }, [onContextSourcesChange, workspaceId])

  const loadConversations = useCallback(async () => {
    setLoadingConversations(true)
    try {
      const nextConversations = await listWorkspaceConversations(workspaceId)
      setConversations(nextConversations)
      onConversationsChange?.(nextConversations)
    } catch {
      toast.error("对话加载失败")
    } finally {
      setLoadingConversations(false)
    }
  }, [onConversationsChange, workspaceId])

  useEffect(() => {
    void loadContextSources()
  }, [loadContextSources])

  useEffect(() => {
    void loadConversations()
  }, [conversationRefreshToken, loadConversations])

  const handleNewConversation = useCallback(async () => {
    try {
      const conversation = await createWorkspaceConversation(workspaceId)
      await loadConversations()
      onSelectConversation(conversation.id)
    } catch {
      toast.error("新对话创建失败")
    }
  }, [loadConversations, onSelectConversation, workspaceId])

  const handleAddFiles = useCallback(async () => {
    const paths = isTauri()
      ? await chooseContextFilePathsInTauri()
      : window.prompt("输入本地文件绝对路径")?.split("\n").map((path) => path.trim()).filter(Boolean) ?? []
    if (paths.length === 0) return
    try {
      await Promise.all(paths.map((path) => addFileContextSource(workspaceId, path)))
      await loadContextSources()
      toast.success("已添加本地文件")
    } catch {
      toast.error("添加本地文件失败")
    }
  }, [loadContextSources, workspaceId])

  const handleAddDirectory = useCallback(async () => {
    const path = isTauri() ? await chooseContextDirectoryPathInTauri() : window.prompt("输入本地文件夹绝对路径")
    if (!path) return
    try {
      await addDirectoryContextSource(workspaceId, path)
      await loadContextSources()
      toast.success("已添加本地文件夹")
    } catch {
      toast.error("添加本地文件夹失败")
    }
  }, [loadContextSources, workspaceId])

  const handleAddWebpage = useCallback(async () => {
    const trimmed = webUrl.trim()
    if (!trimmed) return
    setAddingWebpage(true)
    try {
      await addWebpageContextSource(workspaceId, trimmed)
      setWebUrl("")
      setWebDialogOpen(false)
      await loadContextSources()
      toast.success("已添加网页链接")
    } catch {
      toast.error("添加网页链接失败")
    } finally {
      setAddingWebpage(false)
    }
  }, [loadContextSources, webUrl, workspaceId])

  const openPlugins = useCallback(async () => {
    setPluginDialogOpen(true)
    try {
      setPlugins(await listWorkspacePlugins(workspaceId))
    } catch {
      toast.error("插件加载失败")
    }
  }, [workspaceId])

  const openRenameConversation = useCallback((conversation: AgentConversation) => {
    setRenamingConversation(conversation)
    setRenameDraft(conversation.name?.trim() || conversation.preview.trim() || "")
  }, [])

  const handleRenameConversation = useCallback(async () => {
    if (!renamingConversation) return
    const nextName = renameDraft.trim()
    if (!nextName) return
    setSavingConversationName(true)
    try {
      await updateWorkspaceConversation(renamingConversation.id, { name: nextName })
      setRenamingConversation(null)
      setRenameDraft("")
      await loadConversations()
    } catch {
      toast.error("重命名对话失败")
    } finally {
      setSavingConversationName(false)
    }
  }, [loadConversations, renameDraft, renamingConversation])

  return (
    <aside className="flex h-full w-[17rem] shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground">
      <div className="flex shrink-0 flex-col gap-1 px-2 py-3">
        <SidebarAction icon={MessageSquarePlus} label="新对话" onClick={() => void handleNewConversation()} />
        <SidebarAction icon={Plug} label="插件" onClick={() => void openPlugins()} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <section className="mb-4">
          <div className="mb-1 flex items-center justify-between px-2">
            <p className="text-xs font-medium text-muted-foreground">上下文</p>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="添加上下文">
                  <Plus className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => void handleAddFiles()}>
                  <File />
                  本地文件
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void handleAddDirectory()}>
                  <Folder />
                  本地文件夹
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setWebDialogOpen(true)}>
                  <LinkIcon />
                  网页链接
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {loadingContext ? (
            <MutedRow icon={Loader2} label="加载上下文" spin />
          ) : contextSources.length === 0 ? (
            <p className="px-2 py-2 text-xs leading-5 text-muted-foreground">还没有添加上下文。</p>
          ) : (
            <div className="space-y-0.5">
              {contextSources.map((source) => (
                <ContextSourceRow
                  key={source.id}
                  source={source}
                  onChanged={loadContextSources}
                />
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="mb-1 flex items-center justify-between px-2">
            <p className="text-xs font-medium text-muted-foreground">对话</p>
            {loadingConversations ? <Loader2 className="size-3 animate-spin text-muted-foreground" /> : null}
          </div>
          {conversations.length === 0 ? (
            <p className="px-2 py-2 text-xs leading-5 text-muted-foreground">还没有对话。</p>
          ) : (
            <div className="space-y-0.5">
              {conversations.map((conversation) => (
                <ConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  active={conversation.id === activeConversationId}
                  onSelect={() => onSelectConversation(conversation.id)}
                  onRename={() => openRenameConversation(conversation)}
                  onChanged={loadConversations}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="border-t border-sidebar-border p-2">
        <SidebarAction icon={Settings} label="设置" onClick={() => setAiSettingsOpen(true)} />
      </div>

      <Dialog open={webDialogOpen} onOpenChange={setWebDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加网页链接</DialogTitle>
            <DialogDescription>添加可供 AI 参考的只读网页资料</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={webUrl}
            placeholder="https://example.com/jobs/frontend"
            onChange={(event) => setWebUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                void handleAddWebpage()
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setWebDialogOpen(false)}>取消</Button>
            <Button onClick={() => void handleAddWebpage()} disabled={!webUrl.trim() || addingWebpage}>
              {addingWebpage ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pluginDialogOpen} onOpenChange={setPluginDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>插件</DialogTitle>
            <DialogDescription>查看当前工作区可用的 Agent 插件</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {plugins.length === 0 ? (
              <p className="text-sm text-muted-foreground">当前工作区还没有可展示的插件。</p>
            ) : plugins.map((plugin) => (
              <div key={plugin.id} className="rounded-md border border-border p-3">
                <p className="text-sm font-medium">{plugin.name}</p>
                {plugin.description ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{plugin.description}</p> : null}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={aiSettingsOpen} onOpenChange={setAiSettingsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>AI 设置</DialogTitle>
            <DialogDescription>配置当前工作区的模型连接参数</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Provider" />
            <Input placeholder="API Key" type="password" />
            <Input placeholder="Base URL" />
            <Input placeholder="Model" defaultValue={defaultAgentModel} />
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={renamingConversation !== null} onOpenChange={(open) => {
        if (!open) {
          setRenamingConversation(null)
          setRenameDraft("")
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名对话</DialogTitle>
            <DialogDescription>保持简短且易于识别</DialogDescription>
          </DialogHeader>
          <Input
            aria-label="对话名称"
            value={renameDraft}
            onChange={(event) => setRenameDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void handleRenameConversation()
            }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenamingConversation(null)}>
              取消
            </Button>
            <Button disabled={!renameDraft.trim() || savingConversationName} onClick={() => void handleRenameConversation()}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  )
}

function SidebarAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-sm transition-colors hover:bg-sidebar-accent"
      onClick={onClick}
    >
      <Icon className="size-4" />
      <span>{label}</span>
    </button>
  )
}

function MutedRow({
  icon: Icon,
  label,
  spin,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  spin?: boolean
}) {
  return (
    <div className="flex h-8 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground">
      <Icon className={cn("size-4", spin && "animate-spin")} />
      <span>{label}</span>
    </div>
  )
}

function ContextSourceRow({
  source,
  onChanged,
}: {
  source: ContextSource
  onChanged: () => Promise<void>
}) {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<ContextSourceChild[]>([])
  const [loading, setLoading] = useState(false)
  const Icon = source.type === "directory" ? Folder : source.type === "webpage" ? LinkIcon : File

  const toggleDirectory = useCallback(async () => {
    if (source.type !== "directory") return
    const nextExpanded = !expanded
    setExpanded(nextExpanded)
    if (!nextExpanded || children.length > 0) return
    setLoading(true)
    try {
      setChildren(await listContextSourceChildren(source.id))
    } catch {
      toast.error("目录读取失败")
    } finally {
      setLoading(false)
    }
  }, [children.length, expanded, source.id, source.type])

  const renameWebpage = useCallback(async () => {
    const title = window.prompt("重命名网页链接", source.title)?.trim()
    if (!title || title === source.title) return
    try {
      await updateContextSourceTitle(source.id, title)
      await onChanged()
    } catch {
      toast.error("重命名失败")
    }
  }, [onChanged, source.id, source.title])

  return (
    <div>
      <div
        className="group flex h-8 items-center gap-1 rounded-md px-2 text-sm transition-colors hover:bg-sidebar-accent"
        title={source.uri}
        onContextMenu={(event) => {
          if (source.type !== "webpage") return
          event.preventDefault()
          renameWebpage()
        }}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          onClick={() => void toggleDirectory()}
        >
          {source.type === "directory" ? (
            expanded ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />
          ) : <span className="w-3.5 shrink-0" />}
          {source.type === "webpage" && source.favicon_url ? (
            <img src={source.favicon_url} alt="" className="size-4 shrink-0 rounded-sm" />
          ) : (
            <Icon className="size-4 shrink-0" />
          )}
          <span className="truncate">{source.title}</span>
        </button>
        <SourceActions source={source} onChanged={onChanged} onRenameWebpage={renameWebpage} />
      </div>
      {source.type === "webpage" && source.summary ? (
        <p className="ml-9 truncate pr-2 text-xs text-muted-foreground">{source.summary}</p>
      ) : null}
      {expanded ? (
        <div>
          {loading ? <MutedRow icon={Loader2} label="读取目录" spin /> : null}
          {children.map((child) => (
            <DirectoryNode key={child.path} sourceId={source.id} child={child} depth={1} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function SourceActions({
  source,
  onChanged,
  onRenameWebpage,
}: {
  source: ContextSource
  onChanged: () => Promise<void>
  onRenameWebpage: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`${source.title} 操作`} className="opacity-0 group-hover:opacity-100">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => void openContextSource(source.id)}>
          打开{source.type === "webpage" ? "链接" : source.type === "directory" ? "文件夹" : ""}
        </DropdownMenuItem>
        {source.type !== "webpage" ? (
          <DropdownMenuItem onSelect={() => void revealContextSource(source.id)}>在文件夹中显示</DropdownMenuItem>
        ) : null}
        {source.type === "webpage" ? <DropdownMenuItem onSelect={onRenameWebpage}>重命名</DropdownMenuItem> : null}
        {source.type === "webpage" ? (
          <DropdownMenuItem onSelect={async () => {
            await refreshContextSource(source.id)
            await onChanged()
          }}>
            刷新信息
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => void navigator.clipboard?.writeText(source.uri)}>复制{source.type === "webpage" ? "链接" : "绝对路径"}</DropdownMenuItem>
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={async () => {
            await removeContextSource(source.id)
            await onChanged()
          }}
        >
          移除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DirectoryNode({ sourceId, child, depth }: DirectoryNodeProps) {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<ContextSourceChild[]>([])
  const [loading, setLoading] = useState(false)
  const isDirectory = child.type === "directory"

  const toggle = useCallback(async () => {
    if (!isDirectory) return
    const nextExpanded = !expanded
    setExpanded(nextExpanded)
    if (!nextExpanded || children.length > 0) return
    setLoading(true)
    try {
      setChildren(await listContextSourceChildren(sourceId, child.path))
    } catch {
      toast.error("目录读取失败")
    } finally {
      setLoading(false)
    }
  }, [child.path, children.length, expanded, isDirectory, sourceId])

  return (
    <div>
      <div
        title={child.uri}
        className="group flex h-8 items-center rounded-md pr-1 text-sm transition-colors hover:bg-sidebar-accent"
        style={{ paddingLeft: `${0.75 + depth * 1}rem` }}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          onClick={() => void toggle()}
        >
          {isDirectory ? (
            expanded ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />
          ) : <span className="w-3.5 shrink-0" />}
          {isDirectory ? <Folder className="size-4 shrink-0" /> : <File className="size-4 shrink-0" />}
          <span className="truncate">{child.name}</span>
        </button>
        <DirectoryNodeActions sourceId={sourceId} child={child} />
      </div>
      {expanded ? (
        <div>
          {loading ? <MutedRow icon={Loader2} label="读取目录" spin /> : null}
          {children.map((item) => (
            <DirectoryNode key={item.path} sourceId={sourceId} child={item} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function DirectoryNodeActions({ sourceId, child }: { sourceId: string; child: ContextSourceChild }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`${child.name} 操作`} className="opacity-0 group-hover:opacity-100">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => void openContextSourceChild(sourceId, child.path)}>
          打开{child.type === "directory" ? "文件夹" : "文件"}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void revealContextSourceChild(sourceId, child.path)}>
          在文件夹中显示
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void navigator.clipboard?.writeText(child.uri)}>
          复制绝对路径
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ConversationRow({
  conversation,
  active,
  onSelect,
  onRename,
  onChanged,
}: {
  conversation: AgentConversation
  active: boolean
  onSelect: () => void
  onRename: () => void
  onChanged: () => Promise<void>
}) {
  const displayTitle = conversationDisplayTitle(conversation)
  return (
    <div
      className={cn("group flex h-8 items-center rounded-md px-2 text-sm transition-colors", active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent")}
      onContextMenu={(event) => {
        event.preventDefault()
        onRename()
      }}
    >
      <button type="button" className="min-w-0 flex-1 truncate text-left" title={displayTitle} onClick={onSelect}>
        {displayTitle}
      </button>
      <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
        {conversation.status === "running" ? <Loader2 className="size-3.5 animate-spin" /> : null}
        {conversation.pinned ? <Pin className="size-3.5" /> : null}
        <span className="text-xs group-hover:hidden">{conversation.last_message_at ? relativeTime(conversation.last_message_at) : ""}</span>
        <button
          type="button"
          aria-label="钉住对话"
          className="hidden rounded-sm p-0.5 hover:bg-background group-hover:inline-flex"
          onClick={async () => {
            await updateWorkspaceConversation(conversation.id, { pinned: !conversation.pinned })
            await onChanged()
          }}
        >
          <Pin className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="删除对话"
          className="hidden rounded-sm p-0.5 hover:bg-background group-hover:inline-flex"
          onClick={async () => {
            if (!window.confirm("确定删除这条对话吗？")) return
            await deleteWorkspaceConversation(conversation.id)
            await onChanged()
          }}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

function conversationDisplayTitle(conversation: AgentConversation): string {
  return conversation.name?.trim() || conversation.preview.trim() || "新对话"
}

function relativeTime(value: string): string {
  const diffMs = Date.now() - Date.parse(value)
  if (!Number.isFinite(diffMs) || diffMs < 0) return ""
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return "刚刚"
  if (minutes < 60) return `${minutes} 分`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时`
  return `${Math.floor(hours / 24)} 天`
}
