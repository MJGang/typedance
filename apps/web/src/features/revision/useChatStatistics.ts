import { useEffect, useState } from "react"
import type { AgentRunEvent, ConversationStatistics } from "@typedance/contracts"
import { getConversationStatistics } from "@/agentHost"

export function statisticsRevision(runs: Record<string, AgentRunEvent[]>): string {
  return Object.values(runs).map((events) => {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      const harness = event.payload.event as { type?: string } | undefined
      if (event.type.startsWith("run_") || event.type === "tool_call_started" || event.type === "tool_call_completed" || event.type === "tool_call_failed"
        || (event.type === "harness_event" && (harness?.type === "model.call.started" || harness?.type === "model.call.completed"))) return event.id
    }
    return ""
  }).join(":")
}

export function useChatStatistics(scope: string, conversationId: string | undefined, revision: string, running = false) {
  const [result, setResult] = useState<{ scope: string; conversationId: string; statistics: ConversationStatistics | null; failed: boolean } | null>(null)
  useEffect(() => {
    if (!conversationId) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let request: AbortController | undefined
    const refresh = async () => {
      request = new AbortController()
      const timeout = setTimeout(() => request?.abort(), 5000)
      let poll = running
      try {
        const statistics = await getConversationStatistics(conversationId, request.signal)
        if (disposed) return
        setResult({ scope, conversationId, statistics, failed: false })
        poll ||= statistics.activity.runs > 0
      } catch {
        if (disposed) return
        setResult((previous) => ({ scope, conversationId,
          statistics: previous?.scope === scope && previous.conversationId === conversationId ? previous.statistics : null, failed: true }))
        poll = true
      } finally { clearTimeout(timeout) }
      if (!disposed && poll) timer = setTimeout(() => void refresh(), 1000)
    }
    void refresh()
    return () => { disposed = true; clearTimeout(timer); request?.abort() }
  }, [scope, conversationId, revision, running])
  return result?.scope === scope && result.conversationId === conversationId ? result : { statistics: null, failed: false }
}
