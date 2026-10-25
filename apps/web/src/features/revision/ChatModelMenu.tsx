import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronDown, ChevronLeft, ChevronRight, Loader2 } from "lucide-react"
import { toast } from "sonner"
import type { ModelSelection, ReasoningEffort } from "@typedance/contracts"
import { getModelSelection, updateModelSelection } from "@/agentHost"
import { subscribeModelSettings } from "@/modelSettingsEvents"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

const effortLabels: Record<ReasoningEffort, string> = { off: "Off", low: "Low", high: "High", max: "Max" }

export function ChatModelMenu({ disabled }: { disabled: boolean }) {
  const [selection, setSelection] = useState<ModelSelection | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const [pane, setPane] = useState<"root" | "model" | "reasoning">("root")
  const generation = useRef(0)
  const mounted = useRef(false)
  const load = useCallback(async () => {
    const request = ++generation.current
    try {
      const value = await getModelSelection()
      if (request !== generation.current) return
      setSelection(value); setError(false)
    } catch { if (request === generation.current) setError(true) }
  }, [])
  useEffect(() => {
    mounted.current = true
    void load()
    const unsubscribe = subscribeModelSettings(() => { void load() })
    return () => { mounted.current = false; generation.current += 1; unsubscribe() }
  }, [load])
  const current = selection?.models.find((model) => model.id === selection.model)
  const effort = selection?.reasoning_effort
  const name = current?.name ?? (error ? "加载模型失败" : "加载模型…")

  async function choose(model: string, reasoning: ReasoningEffort | null) {
    if (saving) return
    generation.current += 1
    setSaving(true)
    try {
      const value = await updateModelSelection({ model, reasoning_effort: reasoning })
      if (!mounted.current) return
      setSelection(value); setError(false)
    } catch (caught) { toast.error(caught instanceof Error ? caught.message : "模型选择保存失败") }
    finally { if (mounted.current) setSaving(false) }
  }

  return <DropdownMenu onOpenChange={(open) => { if (open) { setPane("root"); void load() } }}>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="sm" className="h-8 min-w-0 max-w-full shrink gap-1 px-1.5 text-[11px] @min-[480px]/chat:text-xs" disabled={disabled || saving}
        aria-label={`选择模型，当前 ${name}${effort ? `，推理强度 ${effortLabels[effort]}` : ""}`} title={`${name}${effort ? ` · ${effortLabels[effort]}` : ""}`}>
        {saving ? <Loader2 className="animate-spin" /> : null}
        <span className="truncate">{name}</span>
        {effort ? <span className="shrink-0 text-muted-foreground">{effortLabels[effort]}</span> : null}
        <ChevronDown className="shrink-0" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent side="top" align="end" className="w-64" aria-label="模型与推理强度">
      <DropdownMenuGroup>
        {pane === "root" ? <>
          <DropdownMenuItem disabled={!selection} className="gap-2" onSelect={(event) => { event.preventDefault(); setPane("model") }}>
            <span>模型</span><span className="ml-auto truncate text-xs text-muted-foreground">{name}</span><ChevronRight />
          </DropdownMenuItem>
          {current?.reasoning_efforts.length ? <DropdownMenuItem className="gap-2" onSelect={(event) => { event.preventDefault(); setPane("reasoning") }}>
            <span>推理强度</span><span className="ml-auto text-xs text-muted-foreground">{effort ? effortLabels[effort] : ""}</span><ChevronRight />
          </DropdownMenuItem> : null}
        </> : <>
          <DropdownMenuItem onSelect={(event) => { event.preventDefault(); setPane("root") }}><ChevronLeft />返回</DropdownMenuItem>
          <DropdownMenuLabel>{pane === "model" ? "DeepSeek" : "推理强度"}</DropdownMenuLabel>
          {pane === "model" ? <>
            <DropdownMenuRadioGroup value={selection?.model} onValueChange={(model) => {
              const option = selection?.models.find((entry) => entry.id === model)
              void choose(model, option?.reasoning_efforts.length ? effort ?? "high" : null)
            }}>
              {selection?.models.map((model) => <DropdownMenuRadioItem key={model.id} value={model.id}>{model.name}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </> :
            <DropdownMenuRadioGroup value={effort ?? undefined} onValueChange={(value) => { if (selection) void choose(selection.model, value as ReasoningEffort) }}>
              {current?.reasoning_efforts.map((value) => <DropdownMenuRadioItem key={value} value={value}>{effortLabels[value]}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          }
        </>}
      </DropdownMenuGroup>
      {error ? <p role="alert" className="px-2 py-1 text-xs text-destructive">模型配置加载失败，重新打开可重试</p> : null}
    </DropdownMenuContent>
  </DropdownMenu>
}
