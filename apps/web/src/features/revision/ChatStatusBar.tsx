import { useState, type ReactNode } from "react"
import { Circle, Database, Gauge } from "lucide-react"
import type { ConversationStatistics } from "@typedance/contracts"
import { Button } from "@/components/ui/button"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"

const tokens = (value: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value)
const exact = (value: number) => new Intl.NumberFormat("en").format(Math.round(value))
const duration = (ms: number | null) => ms === null ? "—" : ms < 60_000 ? `${(ms / 1000).toFixed(1).replace(/\.0$/, "")}秒` : `${Math.floor(Math.round(ms / 1000) / 60)}分${Math.round(ms / 1000) % 60}秒`

function StatPill({ label, title, children, icon }: { label: string; title: string; children: ReactNode; icon: ReactNode }) {
  const [open, setOpen] = useState(false)
  return <HoverCard open={open} onOpenChange={setOpen} openDelay={150}>
    <HoverCardTrigger asChild>
      <Button variant="ghost" size="sm" className="h-6 min-w-0 gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground"
        aria-label={title} onClick={() => setOpen(true)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false) }}>
        {icon}<span className="truncate">{label}</span>
      </Button>
    </HoverCardTrigger>
    <HoverCardContent side="top" align="end" className="w-72 max-w-[calc(100vw-2rem)] p-3" role="region" aria-label={`${title}明细`}>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium [&_svg]:size-3.5">{icon}{title}</div>
      <Separator className="mb-2" />
      {children}
    </HoverCardContent>
  </HoverCard>
}

function Reading({ label, value }: { label: string; value: ReactNode }) {
  return <div className="flex items-center justify-between gap-4 py-1 text-xs"><span className="text-muted-foreground">{label}</span><span className="tabular-nums">{value}</span></div>
}

export function ChatStatusBar({ statistics, failed }: { statistics: ConversationStatistics | null; failed: boolean }) {
  const usage = statistics?.usage
  const context = statistics?.context
  const generating = !!statistics?.activity.model_calls
  const hasUsage = !!usage?.measured_calls
  const speed = statistics?.tokens_per_second == null ? generating ? "生成中" : "— tok/s"
    : `${Number(statistics.tokens_per_second.toFixed(1))} tok/s`
  const percent = context?.limit_tokens ? (context.input_tokens + context.output_tokens) / context.limit_tokens * 100 : null
  const percentText = percent === null ? "—" : `${context?.estimated ? "~" : ""}${percent > 0 && percent < 0.01 ? "<0.01" : Number(percent.toFixed(2))}%`
  const cache = usage?.cache_hit_percent
  const cacheText = generating ? "缓存待回报" : cache == null ? "缓存 —" : `缓存 ${Math.floor(cache)}%`
  return <div className="flex min-h-7 min-w-0 flex-wrap items-center justify-end gap-x-0.5 px-1 pt-0.5" aria-label="会话状态栏">
    {failed ? <span className="mr-auto text-[11px] text-muted-foreground">统计连接中断{statistics ? "，显示上次结果" : "，正在重试"}</span> : null}
    <StatPill icon={<Gauge />} title="会话统计" label={`${statistics?.turns ?? 0}轮${statistics?.steps ?? 0}步 · ${speed}`}>
      <Reading label={`模型用时${generating ? "（进行中）" : ""}`} value={duration(statistics?.model_ms ?? null)} />
      <Reading label={`工具调用用时${statistics?.activity.tool_calls ? "（进行中）" : ""}`} value={duration(statistics?.tool_ms ?? null)} />
      <Reading label="首 token 平均（TTFT）" value={duration(statistics?.ttft_ms ?? null)} />
      <Reading label="已完成调用平均速度（TPS）" value={speed} />
      {generating ? <Reading label="当前调用已接收" value={`${exact(statistics!.activity.output_characters)} 字符`} /> : null}
      <p className="mt-1 text-[11px] text-muted-foreground">耗时与接收量每秒刷新。TPS 使用模型回报的输出 Token（含思考）计算，调用结束后更新。</p>
    </StatPill>
    <StatPill icon={<Database />} title="Token 用量" label={`${hasUsage ? tokens(usage!.total_tokens) : "—"} tok · ${cacheText}`}>
      <Reading label="已回报总用量" value={hasUsage ? `${exact(usage!.total_tokens)} tok` : "等待模型回报"} />
      <Reading label="缓存命中" value={cache == null ? "—" : `${Math.floor(cache * 10) / 10}%`} />
      <Reading label="未缓存输入" value={cache == null ? "—" : `${exact(usage!.cache_miss_tokens)} tok`} />
      <Reading label="缓存读取" value={cache == null ? "—" : `${exact(usage!.cache_read_tokens)} tok`} />
      <Reading label="输出（含思考）" value={hasUsage ? `${exact(usage!.output_tokens)} tok` : "—"} />
      {generating ? <p className="mt-1 text-[11px] text-muted-foreground">本次调用用量待模型回报，以上为已完成调用的累计用量。</p> : null}
      {usage?.unmeasured_calls ? <p className="mt-1 text-[11px] text-muted-foreground">{usage.unmeasured_calls} 次调用未返回完整用量，未计入合计。</p> : null}
    </StatPill>
    <StatPill icon={<Circle />} title="上下文占用" label={percentText}>
      {context ? <>
        <Reading label={`上下文已用 ${percentText}`} value={`${context.estimated ? "~" : ""}${tokens(context.input_tokens + context.output_tokens)} / ${context.limit_tokens ? tokens(context.limit_tokens) : "未知"}`} />
        <Progress value={Math.min(100, percent ?? 0)} className="my-2 h-1" aria-label="上下文占用比例" />
        <Reading label="系统提示词" value={`~${tokens(context.system_tokens)}`} />
        <Reading label="工具定义" value={`~${tokens(context.tool_tokens)}`} />
        <Reading label="对话消息" value={`~${tokens(context.conversation_tokens)}`} />
        <p className="mt-2 text-[11px] text-muted-foreground">{context.estimated ? "总量与拆分均为估算。" : "总量来自最近一次模型回报；拆分为估算。"}</p>
      </> : <p className="text-xs text-muted-foreground">发送消息后显示上下文占用。</p>}
    </StatPill>
  </div>
}
