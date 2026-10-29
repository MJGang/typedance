import { AccountSessionEndedError, agentHostFetch, assertAccountSession, captureAccountSession } from "./accountSession"
import { z } from "zod"
import { AgentRunEventSource } from "./agentRunStream"
import { notifyModelSettingsChanged } from "./modelSettingsEvents"
import {
  editorRequestSchema,
  agentConversationSchema,
  agentMessageSchema,
  agentPluginSummarySchema,
  agentRunEventSchema,
  agentRunSchema,
  modelSettingsResponseSchema,
  modelSettingsUpdateSchema,
  modelSelectionSchema,
  modelSelectionUpdateSchema,
  conversationStatisticsSchema,
  type ModelSelection,
  type ConversationStatistics,
  speechStatusSchema,
  type SpeechPreferences,
  type SpeechStatus,
  type HarnessAttachment,
  canvasMutationModeSchema,
  type AgentConversation,
  type AgentMessage,
  type AgentPluginSummary,
  type AgentRun,
  type AgentRunEvent,
  type CanvasMutationMode,
  type ContextMention,
  type EditorReference,
  type EditorRequest,
  type EditorResponse,
  type ModelSettingsResponse,
  type ModelSettingsUpdate,
} from "@typedance/contracts"


export async function getModelSelection(): Promise<ModelSelection> {
  return parseAgentHostResponse(await agentHostFetch(`/settings/model/selection`), (value) => modelSelectionSchema.parse(value), "模型配置加载失败")
}
export async function updateModelSelection(input: Pick<ModelSelection, "model" | "reasoning_effort">): Promise<ModelSelection> {
  const value = await parseAgentHostResponse(await agentHostFetch(`/settings/model/selection`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(modelSelectionUpdateSchema.parse(input)),
  }), (value) => modelSelectionSchema.parse(value), "模型选择保存失败")
  notifyModelSettingsChanged()
  return value
}
export async function getConversationStatistics(conversationId: string, signal?: AbortSignal): Promise<ConversationStatistics> {
  return parseAgentHostResponse(await agentHostFetch(`/conversations/${encodeURIComponent(conversationId)}/statistics`, { signal, cache: "no-store" }), (value) => conversationStatisticsSchema.parse(value), "会话统计加载失败")
}

export async function getSpeechStatus(): Promise<SpeechStatus> {
  return parseAgentHostResponse(await agentHostFetch(`/speech/settings`), (value) => speechStatusSchema.parse(value), "语音设置加载失败")
}
export async function configureSpeech(preferences: SpeechPreferences): Promise<SpeechStatus> {
  return parseAgentHostResponse(await agentHostFetch(`/speech/settings`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(preferences),
  }), (value) => speechStatusSchema.parse(value), "语音设置保存失败")
}
export async function prepareSpeech(cancel = false): Promise<SpeechStatus> {
  return parseAgentHostResponse(await agentHostFetch(`/speech/prepare`, { method: cancel ? "DELETE" : "POST" }),
    (value) => speechStatusSchema.parse(value), "本地模型准备失败")
}
export async function transcribeSpeech(audio: string, signal: AbortSignal): Promise<string> {
  return parseAgentHostResponse(await agentHostFetch(`/speech/transcribe`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ audio }), signal,
  }), (value) => z.object({ text: z.string() }).parse(value).text, "语音转写失败")
}

export async function getEditorRequest(runId: string, requestId: string) {
  const response = await agentHostFetch(`/agent-runs/${encodeURIComponent(runId)}/editor-requests/${encodeURIComponent(requestId)}`)
  return parseAgentHostResponse(response, (value) => editorRequestSchema.parse(value), "编辑请求已结束")
}

export async function respondToEditorRequest(runId: string, requestId: string, result: EditorResponse): Promise<void> {
  const response = await agentHostFetch(`/agent-runs/${encodeURIComponent(runId)}/editor-requests/${encodeURIComponent(requestId)}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(result),
  })
  await parseAgentHostResponse(response, (value) => value, "编辑结果未回传")
}

export async function beginEditorRequest(runId: string, requestId: string): Promise<EditorRequest> {
  const response = await agentHostFetch(`/agent-runs/${encodeURIComponent(runId)}/editor-requests/${encodeURIComponent(requestId)}/execute`, { method: "POST", signal: AbortSignal.timeout(30_000) })
  return parseAgentHostResponse(response, (value) => editorRequestSchema.parse(value), "当前修改已无法应用")
}
export async function listWorkspaceConversations(workspaceId: string, signal?: AbortSignal): Promise<AgentConversation[]> {
  const response = await agentHostFetch(`/workspaces/${encodeURIComponent(workspaceId)}/conversations`, { signal })
  return parseAgentHostResponse(
    response,
    (value) => z.array(agentConversationSchema).parse(value),
    "Failed to list workspace conversations",
  )
}

export async function createWorkspaceConversation(workspaceId: string, name?: string | null): Promise<AgentConversation> {
  const response = await agentHostFetch(`/workspaces/${encodeURIComponent(workspaceId)}/conversations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(name ? { name } : {}),
  })
  return parseAgentHostResponse(
    response,
    (value) => agentConversationSchema.parse(value),
    "Failed to create workspace conversation",
  )
}

export async function updateWorkspaceConversation(
  conversationId: string,
  patch: Partial<Pick<AgentConversation, "name" | "pinned">>,
): Promise<AgentConversation> {
  const response = await agentHostFetch(`/conversations/${encodeURIComponent(conversationId)}`, {
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
  const response = await agentHostFetch(`/conversations/${encodeURIComponent(conversationId)}`, {
    method: "DELETE",
  })
  if (!response.ok) throw new Error(`Failed to delete workspace conversation: ${response.status}`)
}

export async function listConversationMessages(conversationId: string, signal?: AbortSignal): Promise<AgentMessage[]> {
  const response = await agentHostFetch(`/conversations/${encodeURIComponent(conversationId)}/messages`, { signal })
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
  references?: EditorReference[]
  attachments?: HarnessAttachment[]
  mutationMode?: CanvasMutationMode
  resumeFromRunId?: string
  context?: Record<string, unknown>
}): Promise<AgentRun> {
  const response = await agentHostFetch(
    `/workspaces/${encodeURIComponent(input.workspaceId)}/conversations/${encodeURIComponent(input.conversationId)}/runs`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: {
          content: input.content,
          mentions: input.mentions ?? [],
          ...(input.references?.length ? { references: input.references } : {}),
          ...(input.attachments?.length ? { attachments: input.attachments } : {}),
        },
        resume_from_run_id: input.resumeFromRunId,
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
  const response = await agentHostFetch(`/agent-runs/${encodeURIComponent(runId)}`)
  return parseAgentHostResponse(
    response,
    (value) => agentRunSchema.parse(value),
    "Failed to load agent run",
  )
}

export async function sendAgentRunInput(input: {
  runId: string
  content: string
  mentions?: ContextMention[]
  references?: EditorReference[]
  attachments?: HarnessAttachment[]
  context?: Record<string, unknown>
}): Promise<AgentMessage> {
  const response = await agentHostFetch(`/agent-runs/${encodeURIComponent(input.runId)}/input`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: { content: input.content, mentions: input.mentions ?? [],
      references: input.references, attachments: input.attachments }, context: input.context ?? {} }),
  })
  return parseAgentHostResponse(response, (value) => agentMessageSchema.parse(value), "任务已结束或补充发送失败，请重试")
}

export async function cancelAgentRun(runId: string): Promise<void> {
  const response = await agentHostFetch(`/agent-runs/${encodeURIComponent(runId)}/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason: "User cancelled" }),
  })
  if (!response.ok) throw new Error(`Failed to cancel agent run: ${response.status}`)
}

export async function respondToAgentInteraction(runId: string, kind: "questions" | "permissions", requestId: string, body: { answers: Record<string, string> } | { status: "approved" | "denied" }): Promise<void> {
  const response = await agentHostFetch(`/agent-runs/${encodeURIComponent(runId)}/${kind}/${encodeURIComponent(requestId)}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error("请求已结束或提交失败，请刷新后重试")
}

export async function listAgentRunEvents(runId: string, afterSequence = -1, signal?: AbortSignal): Promise<AgentRunEvent[]> {
  const searchParams = new URLSearchParams({ after: String(afterSequence) })
  const response = await agentHostFetch(`/agent-runs/${encodeURIComponent(runId)}/events?${searchParams}`, { signal })
  return parseAgentHostResponse(
    response,
    (value) => z.array(agentRunEventSchema).parse(value),
    "Failed to list agent run events",
  )
}

export function createAgentRunEventSource(runId: string, afterSequence = -1): AgentRunEventSource {
  const session = captureAccountSession()
  const source = new AgentRunEventSource({
    runId, afterSequence, signal: session.activitySignal,
    fetchStream: (after, signal) => agentHostFetch(`/agent-runs/${encodeURIComponent(runId)}/events?${new URLSearchParams({ after: String(after), stream: "1" })}`, { signal }, session),
    getRun: () => { assertAccountSession(session); return getAgentRun(runId) },
    listEvents: (after) => { assertAccountSession(session); return listAgentRunEvents(runId, after) },
  })
  return source
}

export async function getConversationActiveRun(conversationId: string, signal?: AbortSignal): Promise<AgentRun | null> {
  const response = await agentHostFetch(`/conversations/${encodeURIComponent(conversationId)}/active-run`, { signal })
  return parseAgentHostResponse(response, (value) => agentRunSchema.nullable().parse(value), "Failed to load active run")
}

export async function listWorkspacePlugins(workspaceId: string): Promise<AgentPluginSummary[]> {
  const response = await agentHostFetch(`/workspaces/${encodeURIComponent(workspaceId)}/plugins`)
  return parseAgentHostResponse(
    response,
    (value) => z.array(agentPluginSummarySchema).parse(value),
    "Failed to list workspace plugins",
  )
}

export async function getModelSettings(): Promise<ModelSettingsResponse> {
  const response = await agentHostFetch(`/settings/model`)
  return parseAgentHostResponse(
    response,
    (value) => modelSettingsResponseSchema.parse(value),
    "Failed to load model settings",
  )
}

export async function updateModelSettings(input: ModelSettingsUpdate): Promise<ModelSettingsResponse> {
  const payload = modelSettingsUpdateSchema.parse(input)
  const response = await agentHostFetch(`/settings/model`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  })
  const value = await parseAgentHostResponse(
    response,
    (value) => modelSettingsResponseSchema.parse(value),
    "Failed to update model settings",
  )
  notifyModelSettingsChanged()
  return value
}

export async function clearModelApiKey(): Promise<ModelSettingsResponse> {
  const response = await agentHostFetch(`/settings/model/api-key`, { method: "DELETE" })
  return parseAgentHostResponse(
    response,
    (value) => modelSettingsResponseSchema.parse(value),
    "Failed to clear model API key",
  )
}

async function parseAgentHostResponse<T>(
  response: Response,
  parser: (value: unknown) => T,
  fallbackMessage: string,
): Promise<T> {
  const payload = await response.json().catch((error: unknown) => {
    if (error instanceof AccountSessionEndedError) throw error
    return null
  })
  if (!response.ok) {
    const message = typeof payload?.message === "string" ? payload.message : typeof payload?.error === "string" ? payload.error : `${response.status}`
    throw new Error(`${fallbackMessage}: ${message}`)
  }
  return parser(payload)
}
