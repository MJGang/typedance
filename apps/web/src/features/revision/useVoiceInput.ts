import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { getSpeechStatus, transcribeSpeech } from "@/agentHost"
import { microphoneConstraints, microphoneFailureMessage } from "@/lib/microphone"

export type VoicePhase = "idle" | "starting" | "recording" | "transcribing" | "failed"
type Recording = {
  scope: string;
  abort: AbortController; stream?: MediaStream; context?: AudioContext; node?: AudioWorkletNode;
  chunks: Float32Array[]; count: number; timer?: ReturnType<typeof setTimeout>; flush?: () => void;
  stopping?: boolean;
  released?: boolean;
}
const maximumSamples = 16000 * 120

export function pcmBase64(chunks: Float32Array[], count: number): string {
  const bytes = new Uint8Array(count * 2)
  const view = new DataView(bytes.buffer)
  let index = 0
  for (const chunk of chunks) for (const sample of chunk) {
    if (index === count) break
    view.setInt16(index++ * 2, Math.round(Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 32768 : 32767)), true)
  }
  let binary = ""
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(binary)
}

function release(recording: Recording) {
  if (recording.released) return
  recording.released = true
  clearTimeout(recording.timer)
  recording.stream?.getTracks().forEach((track) => { track.onended = null; track.stop() })
  if (recording.node) { recording.node.onprocessorerror = null; recording.node.port.onmessage = null }
  recording.node?.disconnect()
  if (recording.context) recording.context.onstatechange = null
  if (recording.context && recording.context.state !== "closed") void recording.context.close().catch(() => {})
}

export function useVoiceInput(scope: string, onTranscript: (text: string) => void) {
  const [phase, setPhase] = useState<VoicePhase>("idle")
  const [levels, setLevels] = useState<number[]>([])
  const [error, setError] = useState<string | null>(null)
  const operation = useRef<Recording | null>(null)
  const currentScope = useRef(scope)
  currentScope.current = scope
  const onText = useRef(onTranscript)
  onText.current = onTranscript
  const isCurrent = (recording: Recording) => operation.current === recording && currentScope.current === recording.scope
  const stopRef = useRef<() => void>(() => {})

  function cancel() {
    const current = operation.current
    operation.current = null
    if (current) { current.abort.abort(); release(current); current.flush?.() }
    setPhase("idle"); setLevels([]); setError(null)
  }
  useEffect(() => {
    const hide = () => { if (document.hidden) cancel() }
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && operation.current) { event.preventDefault(); cancel() } }
    document.addEventListener("visibilitychange", hide)
    document.addEventListener("keydown", escape)
    return () => { cancel(); document.removeEventListener("visibilitychange", hide); document.removeEventListener("keydown", escape) }
  }, [scope])

  async function start() {
    if (operation.current) return
    const current: Recording = { scope, abort: new AbortController(), chunks: [], count: 0 }
    operation.current = current; setPhase("starting")
    try {
      if (!navigator.mediaDevices?.getUserMedia || !globalThis.AudioContext || !globalThis.AudioWorkletNode) throw new Error("当前环境不支持麦克风录音，请使用最新版桌面客户端")
      const status = await getSpeechStatus()
      if (!isCurrent(current)) return
      if (status.phase !== "ready") throw new Error("请先在设置 → 语音输入中下载本地模型")
      const stream = await navigator.mediaDevices.getUserMedia(microphoneConstraints())
      if (!isCurrent(current)) { stream.getTracks().forEach((track) => track.stop()); return }
      current.stream = stream
      const track = stream.getAudioTracks()[0]
      if (!track || track.readyState === "ended") throw new Error("麦克风已断开，请重新录音")
      track.onended = () => { if (isCurrent(current)) { cancel(); toast.error("麦克风已断开，请重新录音") } }
      const context = current.context = new AudioContext({ sampleRate: 16000 })
      await context.audioWorklet.addModule(`${import.meta.env.BASE_URL}pcm-recorder.js`)
      if (!isCurrent(current)) return
      if (context.sampleRate !== 16000) throw new Error("当前录音设备不支持 16 kHz 音频")
      const node = current.node = new AudioWorkletNode(context, "typedance-pcm-recorder", { channelCount: 1, channelCountMode: "explicit" })
      node.onprocessorerror = () => { if (isCurrent(current)) { cancel(); toast.error("录音处理异常，请重新录音") } }
      node.port.onmessage = (event: MessageEvent<{ samples?: Float32Array; flushed?: boolean }>) => {
        if (!isCurrent(current)) return
        if (event.data.flushed) { current.flush?.(); return }
        const samples = event.data.samples
        if (!samples || current.count >= maximumSamples) return
        const chunk = samples.slice(0, maximumSamples - current.count)
        current.chunks.push(chunk); current.count += chunk.length
        const rms = Math.sqrt(chunk.reduce((sum, sample) => sum + sample * sample, 0) / chunk.length)
        setLevels((previous) => [...previous.slice(-59), Math.min(1, rms * 8)])
        if (current.count >= maximumSamples) stopRef.current()
      }
      const source = context.createMediaStreamSource(stream)
      const mute = context.createGain(); mute.gain.value = 0
      source.connect(node); node.connect(mute); mute.connect(context.destination)
      await context.resume()
      if (!isCurrent(current)) return
      context.onstatechange = () => {
        if (isCurrent(current) && !current.stopping && context.state !== "running") { cancel(); toast.error("录音已被系统中断，请重新录音") }
      }
      current.timer = setTimeout(() => stopRef.current(), 120_000)
      setPhase("recording"); setLevels([])
    } catch (error) {
      if (!isCurrent(current)) return
      cancel()
      toast.error(microphoneFailureMessage(error))
    }
  }
  async function stop(retry = false) {
    const current = operation.current
    if (!current || (retry ? phase !== "failed" : current.stopping || phase !== "recording")) return
    current.stopping = true
    clearTimeout(current.timer); setPhase("transcribing"); setError(null)
    let completed = false
    let captureComplete = retry
    try {
      // Flush the final worklet block before shutting down the microphone.
      if (!retry) await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { current.flush = undefined; reject(new Error("录音收尾失败，请重新录音")) }, 2000)
        current.flush = () => { clearTimeout(timer); current.flush = undefined; resolve() }
        current.node?.port.postMessage("flush")
      })
      captureComplete = true
      release(current)
      if (!isCurrent(current)) return
      if (current.count < 1600) { toast.error("录音时间太短，请再说一次"); cancel(); return }
      const text = await transcribeSpeech(pcmBase64(current.chunks, current.count), current.abort.signal)
      if (!isCurrent(current)) return
      if (!text.trim()) throw new Error("没有识别到可转写的文字")
      onText.current(text.trim())
      completed = true
    } catch (cause) {
      if (isCurrent(current)) {
        if (!captureComplete) { cancel(); toast.error(cause instanceof Error ? cause.message : "录音失败，请重新录音") }
        else { setError(cause instanceof Error ? cause.message : "语音转写失败"); setPhase("failed") }
      }
    } finally { release(current); if (completed && operation.current === current) cancel() }
  }
  stopRef.current = () => { void stop() }
  return { phase, levels, error, start, stop, retry: () => stop(true), cancel }
}
