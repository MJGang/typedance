import { useEffect, useState } from "react"
import type { AgentRunEvent, ConversationStatistics } from "@typedance/contracts"
import { getConversationStatistics } from "@/agentHost"

export function statisticsRevision(runs: Record<string, AgentRunEvent[]>): string {
  return Object.values(runs).map((events) => {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      const harness = event.payload.event as { type?: string } | undefined
      if (event.type.startsWith("run_") || event.type === "tool_call_completed" || event.type === "tool_call_failed"
        || (event.type === "harness_event" && (harness?.type === "model.call.started" || harness?.type === "model.call.completed"))) return event.id
    }
    return ""
  }).join(":")
}

export function useChatStatistics(scope: string, conversationId: string | undefined, revision: string) {
  const [result, setResult] = useState<{ scope: string; statistics: ConversationStatistics | null; failed: boolean } | null>(null)
  useEffect(() => {
    let disposed = false
    if (conversationId) void getConversationStatistics(conversationId)
      .then((statistics) => { if (!disposed) setResult({ scope, statistics, failed: false }) })
      .catch(() => { if (!disposed) setResult({ scope, statistics: null, failed: true }) })
    return () => { disposed = true }
  }, [scope, conversationId, revision])
  return result?.scope === scope ? result : { statistics: null, failed: false }
}
