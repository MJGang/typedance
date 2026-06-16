import { z } from "zod"
import {
  agentConversationSchema,
  agentMessageSchema,
  agentPluginSummarySchema,
  agentRunEventSchema,
  agentRunSchema,
  canvasMutationModeSchema,
  type AgentConversation,
  type AgentMessage,
  type AgentPluginSummary,
  type AgentRun,
  type AgentRunEvent,
  type CanvasMutationMode,
  type ContextMention,
} from "@typedance/contracts"

const agentHostBaseUrl = import.meta.env.VITE_AGENT_HOST_URL ?? "http://127.0.0.1:4327"

export async function listWorkspaceConversations(workspaceId: string): Promise<AgentConversation[]> {
  const response = await fetch(`${agentHostBaseUrl}/workspaces/${encodeURIComponent(workspaceId)}/conversations`)
  return parseAgentHostResponse(
    response,
    (value) => z.array(agentConversationSchema).parse(value),
    "Failed to list workspace conversations",
  )
}

export async function createWorkspaceConversation(workspaceId: string, title?: string): Promise<AgentConversation> {
  const response = await fetch(`${agentHostBaseUrl}/workspaces/${encodeURIComponent(workspaceId)}/conversations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(title ? { title } : {}),
  })
  return parseAgentHostResponse(
    response,
    (value) => agentConversationSchema.parse(value),
    "Failed to create workspace conversation",
  )
}

export async function updateWorkspaceConversation(
  conversationId: string,
  patch: Partial<Pick<AgentConversation, "title" | "pinned">>,
): Promise<AgentConversation> {
  const response = await fetch(`${agentHostBaseUrl}/conversations/${encodeURIComponent(conversationId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  })
  return parseAgentHostResponse(
    response,
    (value) => agentConversationSchema.parse(value),
    "Failed to update workspace conversation",
  )
}

export async function deleteWorkspaceConversation(conversationId: string): Promise<void> {
  const response = await fetch(`${agentHostBaseUrl}/conversations/${encodeURIComponent(conversationId)}`, {
    method: "DELETE",
  })
  if (!response.ok) throw new Error(`Failed to delete workspace conversation: ${response.status}`)
}

export async function listConversationMessages(conversationId: string): Promise<AgentMessage[]> {
  const response = await fetch(`${agentHostBaseUrl}/conversations/${encodeURIComponent(conversationId)}/messages`)
  return parseAgentHostResponse(
    response,
    (value) => z.array(agentMessageSchema).parse(value),
    "Failed to list conversation messages",
  )
}

export async function startConversationRun(input: {
  workspaceId: string
  conversationId: string
  content: string
  mentions?: ContextMention[]
  model?: string
  mutationMode?: CanvasMutationMode
  context?: Record<string, unknown>
}): Promise<AgentRun> {
  const response = await fetch(
    `${agentHostBaseUrl}/workspaces/${encodeURIComponent(input.workspaceId)}/conversations/${encodeURIComponent(input.conversationId)}/runs`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: {
          content: input.content,
          mentions: input.mentions ?? [],
        },
        model: input.model,
        mutation_mode: canvasMutationModeSchema.parse(input.mutationMode ?? "review"),
        context: input.context ?? {},
      }),
    },
  )
  return parseAgentHostResponse(
    response,
    (value) => agentRunSchema.parse(value),
    "Failed to start conversation run",
  )
}

export async function getAgentRun(runId: string): Promise<AgentRun> {
  const response = await fetch(`${agentHostBaseUrl}/agent-runs/${encodeURIComponent(runId)}`)
  return parseAgentHostResponse(
    response,
    (value) => agentRunSchema.parse(value),
    "Failed to load agent run",
  )
}

export async function cancelAgentRun(runId: string): Promise<void> {
  const response = await fetch(`${agentHostBaseUrl}/runs/${encodeURIComponent(runId)}/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason: "User cancelled" }),
  })
  if (!response.ok) throw new Error(`Failed to cancel agent run: ${response.status}`)
}

export async function listAgentRunEvents(runId: string, afterSequence = -1): Promise<AgentRunEvent[]> {
  const searchParams = new URLSearchParams({ after: String(afterSequence) })
  const response = await fetch(`${agentHostBaseUrl}/agent-runs/${encodeURIComponent(runId)}/events?${searchParams}`)
  return parseAgentHostResponse(
    response,
    (value) => z.array(agentRunEventSchema).parse(value),
    "Failed to list agent run events",
  )
}

export function createAgentRunEventSource(runId: string, afterSequence = -1): EventSource {
  const searchParams = new URLSearchParams({ after: String(afterSequence), stream: "1" })
  return new EventSource(`${agentHostBaseUrl}/agent-runs/${encodeURIComponent(runId)}/events?${searchParams}`)
}

export async function listWorkspacePlugins(workspaceId: string): Promise<AgentPluginSummary[]> {
  const response = await fetch(`${agentHostBaseUrl}/workspaces/${encodeURIComponent(workspaceId)}/plugins`)
  return parseAgentHostResponse(
    response,
    (value) => z.array(agentPluginSummarySchema).parse(value),
    "Failed to list workspace plugins",
  )
}

async function parseAgentHostResponse<T>(
  response: Response,
  parser: (value: unknown) => T,
  fallbackMessage: string,
): Promise<T> {
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const message = typeof payload?.message === "string" ? payload.message : `${response.status}`
    throw new Error(`${fallbackMessage}: ${message}`)
  }
  return parser(payload)
}
