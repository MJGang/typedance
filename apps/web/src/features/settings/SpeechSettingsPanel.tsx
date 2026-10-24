import { useEffect, useState } from "react"
import { Download, Loader2, Mic, X } from "lucide-react"
import { toast } from "sonner"
import type { SpeechPreferences, SpeechStatus } from "@typedance/contracts"
import { configureSpeech, getSpeechStatus, prepareSpeech } from "@/agentHost"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MicrophoneSettingsPanel } from "./MicrophoneSettingsPanel"

const languageNames = { auto: "自动识别", zh: "中文", en: "英语", yue: "粤语", ja: "日语", ko: "韩语" }
const phaseNames = { checking: "正在检查模型", unprepared: "尚未下载", downloading: "正在下载并校验", ready: "模型已就绪", failed: "准备失败" }

export function SpeechSettingsPanel() {
  const [status, setStatus] = useState<SpeechStatus | null>(null)
  const [preferences, setPreferences] = useState<SpeechPreferences | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    async function refresh() {
      try {
        const value = await getSpeechStatus()
        if (disposed) return
        setStatus(value); setPreferences((current) => current ?? { language: value.language, download_origin: value.download_origin }); setError(null)
        if (value.phase === "checking" || value.phase === "downloading") timer = setTimeout(() => void refresh(), 800)
      } catch { if (!disposed) setError("语音设置加载失败，请确认本机服务已启动后重试。") }
    }
    void refresh()
    return () => { disposed = true; clearTimeout(timer) }
  }, [retry])
  async function perform(action: "save" | "download" | "cancel") {
    if (!preferences) return
    setBusy(true)
    try {
      if (action !== "cancel") await configureSpeech(preferences)
      const value = action === "save" ? await getSpeechStatus() : await prepareSpeech(action === "cancel")
      setStatus(value); setRetry((current) => current + 1)
      if (action === "save") toast.success("语音设置已保存")
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "操作失败") }
    finally { setBusy(false) }
  }
  const preparing = status?.phase === "downloading" || status?.phase === "checking"
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold"><Mic className="size-5" />语音输入</h2>
        <p className="text-sm leading-6 text-muted-foreground">SenseVoiceSmall 在本机 CPU 上识别，无需 API Key 或按次付费。录音仅用于转写，结果先填入草稿。</p>
      </div>
      {error ? <div role="alert" className="flex flex-col items-start gap-2 text-sm"><p>{error}</p><Button variant="outline" onClick={() => setRetry((current) => current + 1)}>重试</Button></div> : null}
      {preferences ? <FieldGroup>
        <MicrophoneSettingsPanel />
        <Field>
          <FieldLabel htmlFor="speech-language">识别语言</FieldLabel>
          <Select value={preferences.language} disabled={busy || preparing} onValueChange={(language) => setPreferences({ ...preferences, language: language as SpeechPreferences["language"] })}>
            <SelectTrigger id="speech-language"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>{Object.entries(languageNames).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
          <FieldDescription>中文短句建议选择中文，可减少自动语言判断偏差。</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="speech-download-origin">模型下载源</FieldLabel>
          <Select value={preferences.download_origin} disabled={busy || preparing} onValueChange={(download_origin) => setPreferences({ ...preferences, download_origin: download_origin as SpeechPreferences["download_origin"] })}>
            <SelectTrigger id="speech-download-origin"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup><SelectItem value="https://hf-mirror.com">HF Mirror</SelectItem><SelectItem value="https://huggingface.co">Hugging Face</SelectItem></SelectGroup></SelectContent>
          </Select>
          <FieldDescription>首次下载约 241 MB，包含 INT8 识别模型与静音检测模型；之后离线使用。下载失败可切换来源重试，已校验的完整文件会复用。</FieldDescription>
        </Field>
      </FieldGroup> : null}
      {status ? <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
        <p role="status" className="text-sm font-medium">{phaseNames[status.phase]}{status.phase === "downloading" ? ` · ${Math.floor(status.completed_bytes / status.total_bytes * 100)}%` : ""}</p>
        {status.phase === "downloading" ? <Progress aria-label="模型下载进度" value={status.completed_bytes / status.total_bytes * 100} /> : null}
        {status.error ? <p role="alert" className="break-words text-sm text-destructive">{status.error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={busy || preparing} onClick={() => void perform("save")}>保存语音设置</Button>
          {preparing ? <Button variant="outline" disabled={busy || status.phase === "checking"} onClick={() => void perform("cancel")}><X data-icon="inline-start" />取消下载</Button>
            : status.phase !== "ready" ? <Button disabled={busy} onClick={() => void perform("download")}>{busy ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Download data-icon="inline-start" />}{status.phase === "failed" ? "重试下载" : "下载本地模型"}</Button> : null}
        </div>
      </div> : null}
    </div>
  )
}
