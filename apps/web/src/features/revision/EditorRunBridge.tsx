import { useEffect, useState } from "react"
import { editorRequestSchema, type AgentRunEvent } from "@typedance/contracts"
import { toast } from "sonner"
import { createAgentRunEventSource, getConversationActiveRun, getEditorRequest, listAgentRunEvents, respondToEditorRequest } from "@/agentHost"
import { useEditorReferences } from "./references/EditorReferences"

/** The document owns editor execution; choosing a different chat only changes its presentation. */
export function EditorRunBridge({ conversationId, revision = 0, onCompleted }: { conversationId: string; revision?: number; onCompleted: () => void }) {
  const [active, setActive] = useState<{ conversationId: string; runId: string | null } | null>(null)
  useEffect(() => {
    const abort = new AbortController()
    let retry: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    const connect = async () => {
      try {
        const run = await getConversationActiveRun(conversationId, abort.signal)
        if (!abort.signal.aborted) setActive({ conversationId, runId: run?.id ?? null })
      } catch {
        if (abort.signal.aborted) return
        if (++attempts === 3) toast.error("画布连接暂时中断，正在重连")
        retry = setTimeout(() => { void connect() }, 1000)
      }
    }
    void connect()
    return () => { abort.abort(); clearTimeout(retry) }
  }, [conversationId, revision])
  return active?.conversationId === conversationId && active.runId
    ? <EditorRunSubscription key={active.runId} runId={active.runId} onCompleted={onCompleted} /> : null
}

function EditorRunSubscription({ runId, onCompleted }: { runId: string; onCompleted: () => void }) {
  const context = useEditorReferences()
  const handleRequest = context?.handleRequest
  const completeRequest = context?.completeRequest
  useEffect(() => {
    if (!handleRequest) return
    let disposed = false
    let source: ReturnType<typeof createAgentRunEventSource> | undefined
    let initializationRetry: ReturnType<typeof setTimeout> | undefined
    let initializationAttempts = 0
    const abort = new AbortController()
    const resolved = new Set<string>()
    const processing = new Set<string>()
    const retries = new Map<string, ReturnType<typeof setTimeout>>()
    const attempts = new Map<string, number>()
    const submit = async (event: AgentRunEvent) => {
      const parsed = editorRequestSchema.safeParse(event.payload.request)
      if (!parsed.success) return
      const request = parsed.data
      if ((request.kind !== "snapshot" && request.mode !== "solo") || resolved.has(request.id) || processing.has(request.id) || retries.has(request.id)) return
      processing.add(request.id)
      try {
        // A replay can include a timed-out request. Only live Host requests may execute.
        const current = await getEditorRequest(runId, request.id)
        if (disposed || resolved.has(request.id)) return
        const result = await handleRequest(current, true)
        await respondToEditorRequest(runId, request.id, result)
        resolved.add(request.id)
        completeRequest?.(request.id)
      } catch (error) {
        if (!disposed && !resolved.has(request.id)) {
          const count = (attempts.get(request.id) ?? 0) + 1
          attempts.set(request.id, count)
          if (count === 3) toast.error(error instanceof Error ? error.message : "画布响应回传失败，正在重连")
          retries.set(request.id, setTimeout(() => {
            retries.delete(request.id)
            if (!disposed && !resolved.has(request.id)) void submit(event)
          }, 1000))
        }
      } finally {
        processing.delete(request.id)
      }
    }
    const receive = (event: AgentRunEvent) => {
      if (disposed) return
      if (event.type === "editor_response") {
        const id = String(event.payload.request_id)
        resolved.add(id)
        clearTimeout(retries.get(id)); retries.delete(id); attempts.delete(id)
        completeRequest?.(id)
      }
      if (event.type === "editor_request") void submit(event)
      if (["run_completed", "run_failed", "run_cancelled"].includes(event.type)) onCompleted()
    }
    const connect = async () => {
      try {
        const events = await listAgentRunEvents(runId, -1, abort.signal)
        if (disposed) return
        for (const event of events) if (event.type === "editor_response") resolved.add(String(event.payload.request_id))
        source = createAgentRunEventSource(runId, events.reduce((cursor, event) => Math.max(cursor, event.sequence), -1))
        for (const type of ["editor_request", "editor_response", "run_completed", "run_failed", "run_cancelled"]) {
          source.addEventListener(type, (event) => receive(JSON.parse((event as MessageEvent).data) as AgentRunEvent))
        }
        for (const event of events) receive(event)
      } catch {
        if (!disposed) {
          if (++initializationAttempts === 3) toast.error("画布连接暂时中断，正在重连")
          initializationRetry = setTimeout(() => { void connect() }, 1000)
        }
      }
    }
    void connect()
    return () => { disposed = true; abort.abort(); clearTimeout(initializationRetry); source?.close(); retries.forEach(clearTimeout) }
  }, [runId, handleRequest, completeRequest, onCompleted])
  return null
}
