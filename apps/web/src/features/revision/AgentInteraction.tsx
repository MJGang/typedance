import { useId, useState } from "react"
import { harnessRunEventSchema, type AgentRunEvent, type HarnessRunEvent, type HarnessUserQuestion } from "@typedance/contracts"
import { respondToAgentInteraction } from "@/agentHost"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"

export function runtimeEvent(event: AgentRunEvent): HarnessRunEvent | undefined {
  if (event.type !== "harness_event") return undefined
  const parsed = harnessRunEventSchema.safeParse(event.payload.event)
  return parsed.success ? parsed.data : undefined
}

export function AgentInteraction({ event, events, runId, active }: { event: HarnessRunEvent; events: AgentRunEvent[]; runId: string; active: boolean }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const [submitted, setSubmitted] = useState(false)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const history = events.flatMap((item) => runtimeEvent(item) ?? [])
  const superseded = (id: string) => history.some((item) => item.type === "interaction.superseded" && item.request_id === id)
  const send = async (kind: "questions" | "permissions", id: string, body: { answers: Record<string, string> } | { status: "approved" | "denied" }) => {
    setPending(true); setError(undefined)
    try { await respondToAgentInteraction(runId, kind, id, body); setSubmitted(true) }
    catch (reason) { setError(reason instanceof Error ? reason.message : "提交失败") }
    finally { setPending(false) }
  }
  if (event.type === "plan.updated") {
    if (history.filter((item) => item.type === "plan.updated").slice(-1)[0]?.id !== event.id) return null
    const labels = { pending: "待处理", in_progress: "进行中", completed: "已完成", failed: "失败", skipped: "已跳过" }
    return <div className="flex flex-col gap-2 text-xs" aria-label="任务计划">
      <p className="text-muted-foreground">任务计划 · {event.items.filter((item) => item.status === "completed").length}/{event.items.length}</p>
      {event.items.map((item) => <p key={item.id} className={item.status === "in_progress" ? "text-foreground" : "text-muted-foreground"}>{labels[item.status]} · {item.title}</p>)}
    </div>
  }
  if (event.type === "context.compacted") return <p role="status" className="text-xs text-muted-foreground">已整理上下文，保留任务目标和进度</p>
  if (event.type === "model.retrying") return <p role="status" className="text-xs text-muted-foreground">连接暂时中断，正在重试 {event.attempt}/{event.max_retries}</p>
  if (event.type === "run.resumed") return <p className="text-xs text-muted-foreground">已恢复任务，将先确认当前状态</p>
  if (event.type === "completion.blocked") return <p role="status" className="text-xs text-muted-foreground">正在核验结果并继续处理</p>
  if (event.type === "permission.requested") {
    const decision = history.find((item) => item.type === "permission.resolved" && item.decision.request_id === event.request.id)
    const ended = !active || submitted || !!decision || superseded(event.request.id)
    return <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <p className="text-sm">{event.request.reason}</p>
      {decision?.type === "permission.resolved" ? <p className="text-xs text-muted-foreground">{decision.decision.status === "approved" ? "已允许本次操作" : "已拒绝"}</p>
        : ended ? <p className="text-xs text-muted-foreground">{submitted ? "已提交决定" : superseded(event.request.id) ? "已按后续要求继续处理" : "请求已结束"}</p>
          : <div className="flex gap-2"><Button size="sm" disabled={pending} onClick={() => void send("permissions", event.request.id, { status: "approved" })}>允许本次</Button><Button size="sm" variant="outline" disabled={pending} onClick={() => void send("permissions", event.request.id, { status: "denied" })}>拒绝</Button></div>}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </div>
  }
  if (event.type !== "user.questions.requested") return null
  const response = history.find((item) => item.type === "user.questions.answered" && item.request_id === event.request_id)
  const closed = !active || submitted || !!response || superseded(event.request_id)
  const accepted = response?.type === "user.questions.answered" ? response.answers : answers
  return <form className="flex flex-col gap-3 rounded-lg border border-border p-3" onSubmit={(e) => { e.preventDefault(); void send("questions", event.request_id, { answers }) }}>
    <FieldGroup>
      {event.questions.map((question) => <QuestionField key={question.id} question={question} value={closed ? accepted[question.id] ?? "" : answers[question.id] ?? ""} disabled={closed || pending}
        onChange={(value) => setAnswers((current) => ({ ...current, [question.id]: value }))} />)}
    </FieldGroup>
    {closed ? <p className="text-xs text-muted-foreground">{response || submitted ? "已回答" : superseded(event.request_id) ? "已按后续要求继续处理" : "请求已结束"}</p>
      : <Button type="submit" size="sm" className="self-start" disabled={pending || event.questions.some((question) => !answers[question.id]?.trim())}>{pending ? "正在提交…" : "提交回答"}</Button>}
    {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
  </form>
}

function QuestionField({ question, value, disabled, onChange }: { question: HarnessUserQuestion; value: string; disabled: boolean; onChange: (value: string) => void }) {
  const inputId = useId()
  return <FieldSet>
    <FieldLegend className="text-sm">{question.header}</FieldLegend>
    <FieldDescription>{question.question}</FieldDescription>
    {question.options ? <RadioGroup value={value} onValueChange={onChange} disabled={disabled} aria-label={question.question}>
      {question.options.map((option, index) => <Field key={option.label} orientation="horizontal">
        <RadioGroupItem value={option.label} id={`${inputId}-${index}`} />
        <div className="flex flex-col gap-1"><FieldLabel htmlFor={`${inputId}-${index}`}>{option.label}</FieldLabel><FieldDescription>{option.description}</FieldDescription></div>
      </Field>)}
    </RadioGroup> : null}
    <Field><FieldLabel htmlFor={inputId}>{question.options ? "或直接填写" : "你的回答"}</FieldLabel><Input id={inputId} value={value} disabled={disabled} maxLength={6000} onChange={(e) => onChange(e.target.value)} /></Field>
  </FieldSet>
}
