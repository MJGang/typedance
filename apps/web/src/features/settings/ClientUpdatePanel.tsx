import { useState } from "react"
import { ArrowUpRight, CheckCircle2, Download, Loader2, PanelsTopLeft, RefreshCw, TriangleAlert } from "lucide-react"
import ReactMarkdown from "react-markdown"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { flushAllSourceCanvasSaves } from "@/features/revision/useSourceCanvasAutosave"
import { clientUpdater } from "./client-updater"
import { useClientUpdater } from "./useClientUpdater"

const phaseTitles = {
  idle: "检查客户端更新", checking: "正在检查更新…", latest: "已是最新版本",
  available: "发现新版本", downloading: "正在下载更新", ready: "更新已准备就绪",
  installing: "正在准备安装…", error: "暂时无法检查更新",
}

function formatBytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function ClientUpdatePanel({ onDismiss }: { onDismiss: () => void }) {
  const state = useClientUpdater()
  const { phase, update, supported, error } = state
  const [confirmRestart, setConfirmRestart] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const automatic = state.automatic && ["checking", "available", "downloading", "ready", "installing"].includes(phase)
  const busy = ["checking", "downloading", "installing"].includes(phase) || preparing || automatic
  const canInstall = !automatic && supported && (phase === "ready" || (phase === "error" && (error === "install" || error === "prepare")))
  const canDownload = !automatic && supported && (phase === "available" || (phase === "error" && error === "download"))
  const percent = state.totalBytes ? Math.min(100, Math.floor(state.downloadedBytes / state.totalBytes * 100)) : null
  const Icon = phase === "error" ? TriangleAlert
    : phase === "checking" || phase === "installing" ? Loader2
      : phase === "latest" || canInstall ? CheckCircle2 : Download
  const title = !supported ? "请在桌面客户端中检查更新"
    : error === "unconfigured" ? "更新服务尚未配置"
      : error === "prepare" ? "更新准备未完成"
    : phase === "error" && error === "download" ? "更新下载失败"
      : phase === "error" && error === "install" ? "更新安装失败" : phaseTitles[phase]

  async function install() {
    setPreparing(true)
    try {
      if (!await flushAllSourceCanvasSaves()) {
        toast.error("画布尚未保存成功，请完成保存后再更新。")
        return
      }
      setConfirmRestart(false)
      await clientUpdater.install()
    } catch {
      toast.error("保存画布失败，请完成保存后再更新。")
    } finally {
      setPreparing(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">客户端更新</h2>
        <p className="text-sm text-muted-foreground">保持客户端为最新版本。</p>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-border bg-secondary"><PanelsTopLeft className="size-6" /></div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="font-semibold">TypeDance</p>
          <p className="text-xs text-muted-foreground">当前版本 v{state.currentVersion}</p>
        </div>
        <Button variant="outline" size="sm" disabled={!supported || busy || canInstall || error === "unconfigured"} onClick={() => void clientUpdater.check()}>
          {phase === "checking" ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
          {phase === "checking" ? "检查中" : "检查更新"}
        </Button>
      </div>

      <Card className="gap-4 bg-background shadow-none" aria-live="polite" aria-atomic="false">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <Icon aria-hidden="true" className={phase === "checking" || phase === "installing" ? "size-4 animate-spin" : "size-4"} />
            {title}
            {update ? <Badge variant="secondary">v{update.version}</Badge> : null}
          </CardTitle>
          <CardDescription>
            {!supported ? "下载与安装更新需要使用 TypeDance 桌面客户端。"
              : error === "unconfigured" ? "当前构建暂未启用在线更新。"
                : phase === "error" ? error === "prepare" ? "资料已保留，请先完成当前操作和内容保存后重试。" : error === "install" ? "请关闭其他 TypeDance 窗口后重试。" : "请检查网络连接后重试。"
                : automatic ? "本轮更新将自动下载、保存资料并重启完成安装。"
                  : phase === "ready" ? "重启后完成安装。"
                  : phase === "latest" ? "你正在使用最新的 TypeDance。"
                    : phase === "idle" ? "检查新版本，获取最新改进。"
                      : phase === "checking" ? "正在获取最新版本信息。"
                        : phase === "installing" ? "客户端即将关闭并重新启动。"
                          : update?.publishedAt ? new Date(update.publishedAt).toLocaleDateString("zh-CN") : "下载期间可继续编辑。"}
          </CardDescription>
        </CardHeader>
        {update && (phase === "available" || phase === "downloading" || canDownload) ? (
          <CardContent className="flex flex-col gap-3">
            {phase === "downloading" ? (
              <div className="flex flex-col gap-2">
                <div className="flex justify-between text-xs"><span>下载进度</span><span>{percent === null ? "正在下载…" : `${percent}%`}</span></div>
                <Progress value={percent} aria-label="更新下载进度" aria-valuenow={percent ?? undefined} aria-valuetext={percent === null ? "下载大小未知" : `${percent}%`} />
                <p className="text-xs text-muted-foreground">{formatBytes(state.downloadedBytes)}{state.totalBytes ? ` / ${formatBytes(state.totalBytes)}` : " · 大小未知"}</p>
              </div>
            ) : null}
            <p className="text-sm font-medium">本次更新</p>
            <div className="max-h-48 overflow-y-auto break-words text-sm leading-6 text-muted-foreground [&_a]:underline [&_li]:ml-4 [&_ol]:list-decimal [&_ul]:list-disc [&_pre]:whitespace-pre-wrap">
              {update.notes ? <ReactMarkdown skipHtml components={{ a: ({ children }) => <span>{children}</span>, img: () => null }}>{update.notes}</ReactMarkdown> : <p>此版本未提供更新说明。</p>}
            </div>
          </CardContent>
        ) : null}
        <CardFooter className="flex flex-wrap justify-end gap-2">
          {phase === "downloading" && !automatic ? <>
            <p className="mr-auto text-xs text-muted-foreground">可继续编辑</p>
            <Button variant="ghost" size="sm" onClick={() => void clientUpdater.cancel().then((cancelled) => { if (!cancelled) toast.error("取消下载失败，请重试。") })}>取消下载</Button>
          </> : null}
          {canDownload ? <>
            <Button variant="outline" size="sm" onClick={onDismiss}>稍后</Button>
            <Button size="sm" onClick={() => void clientUpdater.download()}><Download data-icon="inline-start" />{error === "download" ? "重新下载" : "下载更新"}</Button>
          </> : null}
          {canInstall ? <>
            <Button variant="outline" size="sm" onClick={onDismiss}>稍后</Button>
            <Button size="sm" disabled={preparing} onClick={() => setConfirmRestart(true)}>重启并更新</Button>
          </> : null}
          {supported && error !== "unconfigured" && (phase === "idle" || phase === "latest" || (phase === "error" && !canDownload && !canInstall)) ? (
            <Button variant="outline" size="sm" onClick={() => void clientUpdater.check()}><RefreshCw data-icon="inline-start" />{phase === "error" ? "重试" : "重新检查"}</Button>
          ) : null}
        </CardFooter>
      </Card>

      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="auto-check-updates">工作台启动时自动检查更新</FieldLabel>
          <FieldDescription>登录页始终自动完成更新；在工作台发起的检查只提示版本。</FieldDescription>
          {state.preferenceError ? <p role="alert" className="text-xs text-destructive">偏好未能保存，下次启动后需重新设置。</p> : null}
        </FieldContent>
        <Switch id="auto-check-updates" checked={state.autoCheck} disabled={!supported} onCheckedChange={clientUpdater.setAutoCheck} />
      </Field>
      <Separator className="h-px w-full" />
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <p>上次检查：{state.lastCheckedAt ? new Date(state.lastCheckedAt).toLocaleString("zh-CN") : "尚未检查"}</p>
        {state.releasesUrl ? <Button asChild variant="link" size="sm"><a href={state.releasesUrl} target="_blank" rel="noreferrer" onClick={(event) => {
          if (!supported) return
          event.preventDefault()
          void clientUpdater.openReleaseNotes().then((opened) => { if (!opened) toast.error("无法打开更新日志，请稍后重试。") })
        }}>更新日志<ArrowUpRight data-icon="inline-end" /></a></Button> : <Button variant="link" size="sm" disabled>更新日志<ArrowUpRight data-icon="inline-end" /></Button>}
      </div>

      <AlertDialog open={confirmRestart} onOpenChange={setConfirmRestart}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>重启并更新 TypeDance？</AlertDialogTitle>
            <AlertDialogDescription>将先保存画布，再关闭客户端并安装更新。进行中的 AI 对话会中断，请确认其他编辑内容已保存。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={preparing}>继续编辑</AlertDialogCancel>
            <AlertDialogAction disabled={preparing} onClick={(event) => { event.preventDefault(); void install() }}>
              {preparing ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}{preparing ? "正在保存…" : "确认重启"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
