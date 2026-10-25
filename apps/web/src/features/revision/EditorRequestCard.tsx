import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react"
import { Undo2 } from "lucide-react"
import { editorRequestSchema, type AgentRunEvent, type EditorRequest, type EditorResponse } from "@typedance/contracts"
import { getEditorRequest, respondToEditorRequest } from "@/agentHost"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useEditorReferences } from "./references/EditorReferences"

const TransactionPreview = lazy(() => import("./EditorTransactionPreview"))

export function editorRequests(events: AgentRunEvent[]): EditorRequest[] {
  return events.flatMap((event) => {
    if (event.type !== "editor_request") return []
    const result = editorRequestSchema.safeParse(event.payload.request)
    return result.success ? [result.data] : []
  })
}

export function EditorRequestCard({ runId, request, events, active }: { runId: string; request: EditorRequest; events: AgentRunEvent[]; active: boolean }) {
  const context = useEditorReferences()
  const resolved = events.find((event) => event.type === "editor_response" && event.payload.request_id === request.id)
  const [status, setStatus] = useState<string | undefined>()
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [undone, setUndone] = useState(false)
  const inFlight = useRef(false)
  const resultRef = useRef<EditorResponse | undefined>(undefined)
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const handleRequest = context?.handleRequest
  const completeRequest = context?.completeRequest

  const submit = useCallback(async (approved: boolean) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError("")
    try {
      // 先确认 Host 仍在等待。历史事件、已取消任务和重连回放不能再次写入。
      if (!resultRef.current) {
        const current = await getEditorRequest(runId, request.id)
        resultRef.current = mounted.current && handleRequest ? await handleRequest(current, approved) : { status: "failed", error: "当前编辑器不可用" }
      }
      await respondToEditorRequest(runId, request.id, resultRef.current)
      if (mounted.current) setStatus(resultRef.current.status)
      completeRequest?.(request.id)
      resultRef.current = undefined
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? caught.message : "编辑结果未回传")
    } finally {
      inFlight.current = false
      if (mounted.current) setBusy(false)
    }
  }, [runId, request.id, handleRequest, completeRequest])

  if (request.kind === "snapshot") return error ? <div><p role="alert" className="text-sm text-destructive">{error}</p>{active ? <Button variant="outline" size="sm" disabled={busy} onClick={() => { void submit(true) }}>重试读取画布</Button> : null}</div> : null
  const transaction = request.transaction
  if (!transaction) return null
  const state = undone ? "undone" : String(resolved?.payload.status ?? status ?? (active ? "pending" : "ended"))
  const label = { pending: request.mode === "solo" ? "正在应用" : "等待确认", applied: "已应用", unchanged: "已符合要求", rejected: "保留原文", failed: "未能应用", undone: "已撤销", ended: "请求已结束" }[state] ?? state
  return <Card className="my-3 gap-3" data-testid="editor-transaction">
    <CardHeader className="gap-2">
      <div className="flex items-center justify-between gap-2"><CardTitle>编辑简历</CardTitle><Badge variant="secondary">{label}</Badge></div>
      <p className="text-sm leading-6">{transaction.summary}</p>
    </CardHeader>
    <CardContent className="flex flex-col gap-3">
      <ul className="list-disc pl-5 text-sm text-muted-foreground">{transaction.effects.map((effect, index) => <li key={index}>{effect.title}</li>)}</ul>
      <p className="text-xs text-muted-foreground">仅修改当前简历，模板样式调整不会影响其他简历。</p>
      <Button type="button" variant="outline" size="sm" onClick={() => setPreviewOpen((open) => !open)}>{previewOpen ? "收起预览" : "查看修改预览"}</Button>
      {previewOpen ? <Suspense fallback={<p className="text-xs text-muted-foreground">正在准备预览…</p>}><TransactionPreview transaction={transaction} /></Suspense> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {(state === "failed" || state === "applied") && resolved?.payload.error ? <p role="alert" className="text-sm text-destructive">{String(resolved.payload.error)}</p> : null}
    </CardContent>
    <CardFooter className="flex-wrap gap-2">
      {state === "pending" && active && request.mode === "review" ? <>
        <Button type="button" size="sm" disabled={busy || !!error} onClick={() => { void submit(true) }}>应用修改</Button>
        <Button type="button" variant="outline" size="sm" disabled={busy || !!error} onClick={() => { void submit(false) }}>保留原文</Button>
      </> : null}
      {state === "applied" ? <Button type="button" variant="outline" size="sm" onClick={() => { if (context?.undo(transaction.id)) setUndone(true) }}><Undo2 data-icon="inline-start" />撤销修改</Button> : null}
      {error && active ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { void submit(true) }}>重试回传结果</Button> : null}
    </CardFooter>
  </Card>
}
