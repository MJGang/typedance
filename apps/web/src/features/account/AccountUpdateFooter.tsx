import { cn } from "cn"
import { Progress } from "@/components/ui/progress"
import { useClientUpdater } from "@/features/settings/useClientUpdater"

export function AccountUpdateFooter() {
  const state = useClientUpdater()
  const complete = state.phase === "ready" || state.phase === "installing"
  const percent = complete ? 100 : state.totalBytes ? Math.min(100, Math.floor(state.downloadedBytes / state.totalBytes * 100)) : null
  const indeterminate = state.phase === "checking" || (state.phase === "downloading" && percent === null)
  const active = indeterminate || state.phase === "downloading" || complete
  const title = !state.supported ? "请在桌面客户端更新"
    : state.retrying ? "更新暂不可用，稍后自动重试"
      : state.phase === "error" ? state.error === "unconfigured" ? "暂未启用在线更新" : state.error === "prepare" ? "更新准备失败，资料已保留" : "更新失败，下次启动将重试"
        : state.phase === "latest" ? "已是最新版本"
          : state.phase === "available" ? "发现新版本，正在准备下载…"
            : state.phase === "downloading" ? "正在下载更新"
              : complete ? "下载完成，正在自动重启…" : "正在检查更新…"

  return <footer data-account-update-footer className="shrink-0 text-[11px] text-muted-foreground [--primary:#3b82f6] sm:text-xs">
    <div className="flex h-10 min-w-0 items-center justify-between gap-4 px-6">
      <span className="shrink-0 tabular-nums">v{state.currentVersion}</span>
      <p className="truncate text-right" aria-live="polite" title={title}>
        <span>{title}</span>
        {state.phase === "downloading" && percent !== null ? <span aria-hidden="true" className="tabular-nums"> · {percent}%</span> : null}
      </p>
    </div>
    <Progress
      value={indeterminate ? undefined : percent ?? 0}
      aria-label="客户端更新进度"
      aria-valuenow={indeterminate ? undefined : percent ?? 0}
      aria-valuetext={indeterminate ? title : `${percent ?? 0}%`}
      className={cn("h-0.5 w-full rounded-none bg-transparent [&_[data-slot=progress-indicator]]:rounded-none [&_[data-slot=progress-indicator]]:transition-transform motion-reduce:[&_[data-slot=progress-indicator]]:transition-none", !active && "invisible", indeterminate && "[&_[data-slot=progress-indicator]]:w-1/4 [&_[data-slot=progress-indicator]]:flex-none [&_[data-slot=progress-indicator]]:transform-none! [&_[data-slot=progress-indicator]]:transition-none! motion-safe:[&_[data-slot=progress-indicator]]:animate-pulse")}
    />
  </footer>
}
