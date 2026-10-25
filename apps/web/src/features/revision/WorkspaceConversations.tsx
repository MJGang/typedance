import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import type { AgentConversation } from "@typedance/contracts"
import { toast } from "sonner"
import { listWorkspaceConversations } from "@/agentHost"

type ConversationState = { workspaceId: string; revision: number; conversations: AgentConversation[]; status: "loaded" | "error" }
type Conversations = { conversations: AgentConversation[]; loading: boolean; loaded: boolean; revision: number; refresh: () => void }
const Context = createContext<Conversations | null>(null)
const EMPTY_CONVERSATIONS: AgentConversation[] = []

export function WorkspaceConversationsProvider({ workspaceId, children }: { workspaceId: string; children: ReactNode }) {
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<ConversationState | null>(null)
  const refresh = useCallback(() => setRevision((current) => current + 1), [])
  useEffect(() => {
    if (!workspaceId) return
    const abort = new AbortController()
    let retry: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    const load = async () => {
      try {
        const conversations = await listWorkspaceConversations(workspaceId, abort.signal)
        if (!abort.signal.aborted) setResult({ workspaceId, revision, conversations, status: "loaded" })
      } catch {
        if (abort.signal.aborted) return
        if (++attempts === 3) toast.error("对话连接暂时中断，正在重连")
        setResult((current) => ({ workspaceId, revision, status: "error", conversations: current?.workspaceId === workspaceId ? current.conversations : [] }))
        retry = setTimeout(() => { void load() }, 1000)
      }
    }
    void load()
    return () => { abort.abort(); clearTimeout(retry) }
  }, [workspaceId, revision])
  const conversations = result?.workspaceId === workspaceId ? result.conversations : EMPTY_CONVERSATIONS
  const loading = result?.workspaceId !== workspaceId || result.revision !== revision || result.status === "error"
  const loaded = !loading && result?.status === "loaded"
  const value = useMemo(() => ({ conversations, loading, loaded, revision, refresh }), [conversations, loading, loaded, revision, refresh])
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useWorkspaceConversations() {
  const value = useContext(Context)
  if (!value) throw new Error("WorkspaceConversationsProvider is required")
  return value
}
