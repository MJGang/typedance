import { harnessRunSchema, type HarnessRun } from "@typedance/contracts"

const agentHostBaseUrl = import.meta.env.VITE_AGENT_HOST_URL ?? "http://127.0.0.1:4327"

export type ResumeAgentAction =
  | "import_old_resume"
  | "blank_guided_generate"
  | "quality_review"
  | "issue_action"
  | "opportunity_calibrate"

export type StartResumeAgentRunInput = {
  action: ResumeAgentAction
  userMessage: string
  context?: Record<string, unknown>
}

export async function startResumeAgentRun(input: StartResumeAgentRunInput): Promise<HarnessRun> {
  const response = await fetch(`${agentHostBaseUrl}/packs/resume/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: input.action,
      user_message: input.userMessage,
      context: input.context ?? {},
    }),
  })
  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    const message = typeof payload?.message === "string" ? payload.message : `${response.status}`
    throw new Error(`Failed to start resume agent run: ${message}`)
  }

  return harnessRunSchema.parse(payload)
}

export function createResumeAgentEventSource(runId: string, afterSequence = -1): EventSource {
  const searchParams = new URLSearchParams({ after: String(afterSequence) })
  return new EventSource(`${agentHostBaseUrl}/runs/${encodeURIComponent(runId)}/events?${searchParams}`)
}
