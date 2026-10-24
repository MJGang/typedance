import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { getMicrophoneChoice, microphoneConstraints, microphoneFailureMessage, saveMicrophoneChoice } from "@/lib/microphone"

type Preview = { id: string; stream?: MediaStream; context?: AudioContext; timer?: ReturnType<typeof setInterval> }

export function MicrophoneSettingsPanel() {
  const [choice, setChoice] = useState(getMicrophoneChoice)
  const [devices, setDevices] = useState<MediaDeviceInfo[] | null>(null)
  const [phase, setPhase] = useState<"idle" | "starting" | "active">("idle")
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const operation = useRef<Preview | null>(null)
  const alive = useRef(false)
  const enumeration = useRef(0)
  const stop = useCallback(() => {
    const current = operation.current
    operation.current = null
    if (current) {
      clearInterval(current.timer)
      current.stream?.getTracks().forEach((track) => { track.onended = null; track.stop() })
      if (current.context) current.context.onstatechange = null
      if (current.context && current.context.state !== "closed") void current.context.close().catch(() => {})
    }
    setPhase("idle"); setLevel(0)
  }, [])
  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    const generation = ++enumeration.current
    try {
      const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "audioinput")
      if (!alive.current || generation !== enumeration.current) return
      setDevices(inputs)
      const current = operation.current
      const known = inputs.length === 0 || inputs.some((device) => device.label)
      if (current?.stream && known && (current.id ? !inputs.some((device) => device.deviceId === current.id) : inputs.length === 0)) {
        stop(); setError("所选麦克风已断开，请重新选择录音设备")
      }
    } catch { if (alive.current && generation === enumeration.current) setError("麦克风列表读取失败，可重试刷新") }
  }, [stop])
  useEffect(() => {
    alive.current = true
    const changed = () => { void refresh() }
    const hidden = () => { if (document.hidden) stop(); else changed() }
    changed()
    navigator.mediaDevices?.addEventListener?.("devicechange", changed)
    document.addEventListener("visibilitychange", hidden)
    return () => {
      alive.current = false; enumeration.current++; stop()
      navigator.mediaDevices?.removeEventListener?.("devicechange", changed)
      document.removeEventListener("visibilitychange", hidden)
    }
  }, [refresh, stop])
  async function start() {
    if (operation.current) return
    const current: Preview = { id: choice.id }
    enumeration.current++
    operation.current = current; setPhase("starting"); setError(null)
    try {
      if (!navigator.mediaDevices?.getUserMedia || !globalThis.AudioContext) throw new Error("当前环境不支持麦克风测试")
      const stream = await navigator.mediaDevices.getUserMedia(microphoneConstraints(choice))
      if (operation.current !== current) { stream.getTracks().forEach((track) => track.stop()); return }
      current.stream = stream
      const track = stream.getAudioTracks()[0]
      if (!track || track.readyState === "ended") throw new Error("麦克风已断开，请检查设备后重试")
      track.onended = () => { if (operation.current === current) { stop(); setError("麦克风已断开，请检查设备后重试") } }
      const context = current.context = new AudioContext()
      const analyser = context.createAnalyser(); analyser.fftSize = 256
      const samples = new Float32Array(256)
      context.createMediaStreamSource(stream).connect(analyser)
      await context.resume()
      if (operation.current !== current) return
      context.onstatechange = () => {
        if (operation.current === current && context.state !== "running") { stop(); setError("麦克风测试已被系统中断，请重试") }
      }
      current.timer = setInterval(() => {
        if (operation.current !== current) return
        analyser.getFloatTimeDomainData(samples)
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length)
        setLevel(Math.max(0, Math.min(100, (20 * Math.log10(Math.max(rms, .00001)) + 60) / 60 * 100)))
      }, 100)
      setPhase("active"); void refresh()
    } catch (cause) {
      if (operation.current !== current) return
      stop(); setError(microphoneFailureMessage(cause))
    }
  }
  const physical = (devices ?? []).filter((device) => device.deviceId && device.deviceId !== "default")
  const known = devices !== null && (devices.length === 0 || devices.some((device) => device.label))
  const missing = choice.id && !physical.some((device) => device.deviceId === choice.id)
  const defaultLabel = devices?.find((device) => device.deviceId === "default")?.label
  const supported = Boolean(navigator.mediaDevices?.getUserMedia)
  return <Field>
    <FieldLabel htmlFor="speech-microphone">录音设备</FieldLabel>
    <Select value={choice.id || "__system__"} disabled={!supported} onValueChange={(value) => {
      const selected = physical.find((device) => device.deviceId === value)
      const next = value === "__system__" ? { id: "", label: "" } : { id: value, label: selected?.label ?? "" }
      try { saveMicrophoneChoice(next); stop(); setChoice(next); setError(null); void refresh() }
      catch { setError("录音设备选择保存失败，请重试") }
    }}>
      <SelectTrigger id="speech-microphone" title={choice.id ? choice.label : defaultLabel || "系统默认麦克风"}><SelectValue /></SelectTrigger>
      <SelectContent><SelectGroup>
        <SelectItem value="__system__">系统默认麦克风{defaultLabel ? ` · ${defaultLabel}` : ""}</SelectItem>
        {physical.map((device, index) => <SelectItem key={device.deviceId} value={device.deviceId} title={device.label}>{device.label || `麦克风 ${index + 1}`}</SelectItem>)}
        {missing ? <SelectItem value={choice.id} disabled={known}>{choice.label || "已保存的麦克风"}{known ? "（已不可用）" : "（授权后确认）"}</SelectItem> : null}
      </SelectGroup></SelectContent>
    </Select>
    <FieldDescription>设备选择立即保存，下次录音生效。测试仅显示输入音量，不保存或发送声音。</FieldDescription>
    <div className="flex items-center gap-3">
      <Button type="button" variant="outline" size="sm" disabled={!supported} onClick={() => phase === "idle" ? void start() : stop()}>{phase === "idle" ? "测试麦克风" : "停止测试"}</Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => { setError(null); void refresh() }}>刷新设备</Button>
      {phase === "starting" ? <span role="status" className="text-xs text-muted-foreground">正在打开麦克风</span> : null}
      {phase === "active" ? <Progress aria-label="麦克风输入音量" aria-valuenow={level} value={level} className="min-w-16 flex-1" /> : null}
    </div>
    {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
  </Field>
}
