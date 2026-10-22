import { useState } from "react"
import { Undo2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { recordTextEditDecision } from "@/agentHost"
import { toast } from "sonner"
import { textEditPreviewSchema, type AgentRunEvent, type TextEditPreview } from "@typedance/contracts"
import { useEditorReferences } from "./EditorReferences"

export function textEditPreviews(events: AgentRunEvent[]): TextEditPreview[] {
  const previews = new Map<string, TextEditPreview>()
  for (const event of events) {
    if (event.type !== "tool_call_completed") continue
    const result = event.payload.result as { output?: unknown } | undefined
    const parsed = textEditPreviewSchema.safeParse(result?.output)
    if (parsed.success) previews.set(parsed.data.id, parsed.data)
  }
  return [...previews.values()]
}

type Decision = "applied" | "ignored" | "undone"

export function TextEditPreviewCard({ preview, runId, events }: { preview: TextEditPreview; runId: string; events: AgentRunEvent[] }) {
  const context = useEditorReferences()
  const [status, setStatus] = useState<"proposed" | Decision>(() => {
    const last = events.filter((event) => event.type === "text_edit_decision" && event.payload.preview_id === preview.id).pop()?.payload.status
    return last === "applied" || last === "ignored" || last === "undone" ? last : "proposed"
  })
  const [saving, setSaving] = useState(false)
  const [retry, setRetry] = useState<Decision | null>(null)
  const record = async (next: Decision) => {
    setStatus(next)
    setSaving(true)
    try { await recordTextEditDecision(runId, preview.id, next); setRetry(null) }
    catch { setRetry(next); toast.error("操作记录未保存，请重试保存记录。") }
    finally { setSaving(false) }
  }
  return <Card className="my-3 gap-3" data-testid="text-edit-preview">
    <CardHeader className="gap-2">
      <div className="flex items-center justify-between gap-2"><CardTitle>局部修改</CardTitle><Badge variant="secondary">{status === "applied" ? "已应用" : status === "ignored" ? "保留原文" : status === "undone" ? "已撤销" : "修改预览"}</Badge></div>
      {preview.summary ? <p className="text-xs leading-5 text-muted-foreground">{preview.summary}</p> : null}
    </CardHeader>
    <CardContent className="flex flex-col gap-2">
      <div className="rounded-lg border border-border bg-muted/50 p-3"><p className="mb-1 text-xs text-muted-foreground">原文</p><p className="whitespace-pre-wrap break-words text-sm leading-6">{preview.original_text}</p></div>
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-3"><p className="mb-1 text-xs text-muted-foreground">修改后</p><p className="whitespace-pre-wrap break-words text-sm leading-6">{preview.replacement || "（删除所选文字）"}</p></div>
      <p className="text-xs text-muted-foreground">仅修改此处引用，保留其他内容与排版。</p>
    </CardContent>
    <CardFooter className="flex-wrap gap-2">
      {status === "proposed" || status === "undone" ? <>
        <Button type="button" size="sm" disabled={!context || saving || !!retry} onClick={() => { if (context?.apply(preview)) void record("applied") }}>应用修改</Button>
        <Button type="button" variant="outline" size="sm" disabled={saving || !!retry} onClick={() => { void record("ignored") }}>保留原文</Button>
      </> : null}
      {status === "applied" ? <Button type="button" variant="outline" size="sm" disabled={saving || !!retry} onClick={() => { if (context?.undo(preview.id)) void record("undone") }}><Undo2 data-icon="inline-start" />撤销修改</Button> : null}
      {retry ? <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => { void record(retry) }}>重试保存记录</Button> : null}
    </CardFooter>
  </Card>
}
