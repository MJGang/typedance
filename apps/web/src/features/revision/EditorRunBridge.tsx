import { useEffect } from "react"
import { editorRequestSchema, type AgentRunEvent } from "@typedance/contracts"
import { toast } from "sonner"
import { createAgentRunEventSource, getConversationActiveRun, getEditorRequest, listAgentRunEvents, respondToEditorRequest } from "@/agentHost"
import { useEditorReferences } from "./references/EditorReferences"

/** The document owns editor execution; choosing a different chat only changes its presentation. */
export function EditorRunBridge({ conversationId, onCompleted }: { conversationId: string; onCompleted: () => void }) {
  const context = useEditorReferences()
  const handleRequest = context?.handleRequest
  const completeRequest = context?.completeRequest
  useEffect(() => {
    if (!handleRequest) return
    let disposed = false
    let source: ReturnType<typeof createAgentRunEventSource> | undefined
    const abort = new AbortController()
    const resolved = new Set<string>()
    const processing = new Set<string>()
    const retries = new Map<string, ReturnType<typeof setTimeout>>()
    const attempts = new Map<string, number>()
    const submit = async (runId: string, event: AgentRunEvent) => {
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
            if (!disposed && !resolved.has(request.id)) void submit(runId, event)
          }, 1000))
        }
      } finally {
        processing.delete(request.id)
      }
    }
    const receive = (runId: string, event: AgentRunEvent) => {
      if (disposed) return
      if (event.type === "editor_response") {
        const id = String(event.payload.request_id)
        resolved.add(id)
        clearTimeout(retries.get(id)); retries.delete(id); attempts.delete(id)
        completeRequest?.(id)
      }
      if (event.type === "editor_request") void submit(runId, event)
      if (["run_completed", "run_failed", "run_cancelled"].includes(event.type)) onCompleted()
    }
    void (async () => {
      try {
        const run = await getConversationActiveRun(conversationId, abort.signal)
        if (disposed || !run) return
        const events = await listAgentRunEvents(run.id, -1, abort.signal)
        if (disposed) return
        for (const event of events) if (event.type === "editor_response") resolved.add(String(event.payload.request_id))
        source = createAgentRunEventSource(run.id, events.reduce((cursor, event) => Math.max(cursor, event.sequence), -1))
        for (const type of ["editor_request", "editor_response", "run_completed", "run_failed", "run_cancelled"]) {
          source.addEventListener(type, (event) => receive(run.id, JSON.parse((event as MessageEvent).data) as AgentRunEvent))
        }
        for (const event of events) receive(run.id, event)
      } catch {
        if (!disposed) toast.error("运行中的画布连接失败，请重新打开简历")
      }
    })()
    return () => { disposed = true; abort.abort(); source?.close(); retries.forEach(clearTimeout) }
  }, [conversationId, handleRequest, completeRequest, onCompleted])
  return null
}
