import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import type { AgentConversation } from "@typedance/contracts"
import { toast } from "sonner"
import { listWorkspaceConversations } from "@/agentHost"

type ConversationState = { workspaceId: string; revision: number; conversations: AgentConversation[]; status: "loaded" | "error" }
type Conversations = { conversations: AgentConversation[]; loading: boolean; loaded: boolean; refresh: () => void }
const Context = createContext<Conversations | null>(null)
const EMPTY_CONVERSATIONS: AgentConversation[] = []

export function WorkspaceConversationsProvider({ workspaceId, children }: { workspaceId: string; children: ReactNode }) {
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<ConversationState | null>(null)
  const refresh = useCallback(() => setRevision((current) => current + 1), [])
  useEffect(() => {
    if (!workspaceId) return
    const abort = new AbortController()
    void listWorkspaceConversations(workspaceId, abort.signal).then((conversations) => {
      if (!abort.signal.aborted) setResult({ workspaceId, revision, conversations, status: "loaded" })
    }).catch(() => {
      if (abort.signal.aborted) return
      toast.error("对话加载失败")
      setResult((current) => ({ workspaceId, revision, status: "error", conversations: current?.workspaceId === workspaceId ? current.conversations : [] }))
    })
    return () => abort.abort()
  }, [workspaceId, revision])
  const conversations = result?.workspaceId === workspaceId ? result.conversations : EMPTY_CONVERSATIONS
  const loading = result?.workspaceId !== workspaceId || result.revision !== revision
  const loaded = !loading && result?.status === "loaded"
  const value = useMemo(() => ({ conversations, loading, loaded, refresh }), [conversations, loading, loaded, refresh])
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useWorkspaceConversations() {
  const value = useContext(Context)
  if (!value) throw new Error("WorkspaceConversationsProvider is required")
  return value
}
