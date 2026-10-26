import { memo } from "react"
import { ChatStatusBar } from "./ChatStatusBar"
import { useChatStatistics } from "./useChatStatistics"

// 把每秒更新留在状态栏，避免重绘消息列表和编辑器。
export const LiveChatStatusBar = memo(function LiveChatStatusBar({ scope, conversationId, revision, running }: {
  scope: string; conversationId: string | undefined; revision: string; running: boolean
}) {
  const result = useChatStatistics(scope, conversationId, revision, running)
  return <ChatStatusBar statistics={result.statistics} failed={result.failed} />
})
