import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { pcmBase64, useVoiceInput } from "./useVoiceInput"
import { saveMicrophoneChoice } from "@/lib/microphone"

const speech = vi.hoisted(() => ({ status: vi.fn(), transcribe: vi.fn() }))
const feedback = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock("@/agentHost", () => ({ getSpeechStatus: speech.status, transcribeSpeech: speech.transcribe }))
vi.mock("sonner", () => ({ toast: feedback }))

beforeEach(() => localStorage.clear())
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); speech.status.mockReset(); speech.transcribe.mockReset(); feedback.error.mockReset(); localStorage.clear() })
function microphone(permission: Promise<MediaStream>) {
  const port: { onmessage: ((event: unknown) => void) | null; postMessage: ReturnType<typeof vi.fn> } = { onmessage: null, postMessage: vi.fn() }
  port.postMessage.mockImplementation(() => queueMicrotask(() => port.onmessage?.({ data: { flushed: true } })))
  const close = vi.fn().mockResolvedValue(undefined)
  const disconnect = vi.fn()
  const addModule = vi.fn().mockResolvedValue(undefined)
  let processorError = () => {}
  let interrupt = () => {}
  vi.stubGlobal("AudioContext", class {
    constructor() { interrupt = () => { this.state = "suspended"; this.onstatechange?.() } }
    sampleRate = 16000
    state = "running"
    onstatechange: (() => void) | null = null
    destination = {}
    audioWorklet = { addModule }
    createMediaStreamSource() { return { connect: vi.fn() } }
    createGain() { return { gain: { value: 1 }, connect: vi.fn() } }
    resume = vi.fn().mockResolvedValue(undefined)
    close = close
  })
  vi.stubGlobal("AudioWorkletNode", class { constructor() { processorError = () => this.onprocessorerror?.() } onprocessorerror: (() => void) | null = null; port = port; connect = vi.fn(); disconnect = disconnect })
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn().mockReturnValue(permission) } })
  speech.status.mockResolvedValue({ phase: "ready" })
  return { port, close, disconnect, addModule, processorError: () => processorError(), interrupt: () => interrupt() }
}

describe("voice input", () => {
  it("handles a device disconnect while the worklet module is still loading", async () => {
    const track = { stop: vi.fn(), onended: null as (() => void) | null }
    const mic = microphone(Promise.resolve({ getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream))
    let finishLoading!: () => void
    mic.addModule.mockReturnValue(new Promise<void>((resolve) => { finishLoading = resolve }))
    const { result } = renderHook(() => useVoiceInput("a", vi.fn()))
    let starting!: Promise<void>
    act(() => { starting = result.current.start() })
    await waitFor(() => expect(mic.addModule).toHaveBeenCalled())
    act(() => track.onended?.())
    await act(async () => { finishLoading(); await starting })
    expect(result.current.phase).toBe("idle")
    expect(track.stop).toHaveBeenCalledOnce()
    expect(mic.close).toHaveBeenCalledOnce()
    expect(speech.transcribe).not.toHaveBeenCalled()
  })
  it("uses the explicitly selected microphone and does not silently switch on device failure", async () => {
    saveMicrophoneChoice({ id: "usb-mic", label: "USB 麦克风" })
    const mic = microphone(Promise.resolve({} as MediaStream))
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(new DOMException("missing", "OverconstrainedError"))
    const { result } = renderHook(() => useVoiceInput("a", vi.fn()))
    await act(async () => result.current.start())
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledExactlyOnceWith({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, deviceId: { exact: "usb-mic" } }, video: false })
    expect(feedback.error).toHaveBeenCalledWith(expect.stringContaining("所选麦克风已不可用"))
    expect(result.current.phase).toBe("idle")
    expect(mic.close).not.toHaveBeenCalled()
  })
  it.each(["processor", "context"])("releases interrupted capture without sending partial audio (%s)", async (kind) => {
    const track = { stop: vi.fn(), onended: null }
    const mic = microphone(Promise.resolve({ getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream))
    mic.close.mockRejectedValue(new Error("device close failed"))
    const { result } = renderHook(() => useVoiceInput("a", vi.fn()))
    await act(async () => result.current.start())
    act(() => { if (kind === "processor") mic.processorError(); else mic.interrupt() })
    expect(result.current.phase).toBe("idle")
    expect(track.stop).toHaveBeenCalledOnce()
    expect(mic.close).toHaveBeenCalledOnce()
    expect(speech.transcribe).not.toHaveBeenCalled()
    expect(feedback.error).toHaveBeenCalledWith(expect.stringContaining("重新录音"))
  })
  it("does not transcribe an incomplete recording when the worklet fails to acknowledge its final block", async () => {
    vi.useFakeTimers()
    const track = { stop: vi.fn(), onended: null }
    const mic = microphone(Promise.resolve({ getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream))
    mic.port.postMessage.mockImplementation(() => {})
    const { result } = renderHook(() => useVoiceInput("a", vi.fn()))
    await act(async () => result.current.start())
    act(() => mic.port.onmessage?.({ data: { samples: new Float32Array(3200).fill(.2) } }))
    let stopping!: Promise<void>
    act(() => { stopping = result.current.stop() })
    await act(async () => { await vi.advanceTimersByTimeAsync(2001); await stopping })
    expect(result.current.phase).toBe("idle")
    expect(speech.transcribe).not.toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalledOnce()
    expect(feedback.error).toHaveBeenCalledWith("录音收尾失败，请重新录音")
  })
  it("retains audio when recognition returns no text and retries the exact recording", async () => {
    const track = { stop: vi.fn(), onended: null }
    const mic = microphone(Promise.resolve({ getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream))
    speech.transcribe.mockResolvedValueOnce("  ").mockResolvedValueOnce("你好呀")
    const onText = vi.fn()
    const { result } = renderHook(() => useVoiceInput("a", onText))
    await act(async () => result.current.start())
    act(() => mic.port.onmessage?.({ data: { samples: new Float32Array(16000).fill(0.02) } }))
    await act(async () => result.current.stop())
    expect(result.current.phase).toBe("failed")
    expect(result.current.error).toContain("没有识别到可转写的文字")
    expect(onText).not.toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalled()
    await act(async () => result.current.retry())
    expect(speech.transcribe.mock.calls[1][0]).toBe(speech.transcribe.mock.calls[0][0])
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce()
    expect(onText).toHaveBeenCalledWith("你好呀")
    expect(result.current.phase).toBe("idle")
  })
  it("keeps failed audio in memory for retry without reopening the microphone", async () => {
    const track = { stop: vi.fn(), onended: null }
    const mic = microphone(Promise.resolve({ getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream))
    speech.transcribe.mockRejectedValueOnce(new Error("识别暂时不可用")).mockResolvedValueOnce("重试成功")
    const onText = vi.fn()
    const { result } = renderHook(() => useVoiceInput("a", onText))
    await act(async () => result.current.start())
    act(() => mic.port.onmessage?.({ data: { samples: new Float32Array(3200).fill(0.25) } }))
    await act(async () => result.current.stop())
    expect(result.current.phase).toBe("failed")
    expect(result.current.error).toBe("识别暂时不可用")
    expect(track.stop).toHaveBeenCalled()
    await act(async () => result.current.retry())
    expect(speech.transcribe.mock.calls[1][0]).toBe(speech.transcribe.mock.calls[0][0])
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce()
    expect(onText).toHaveBeenCalledWith("重试成功")
    expect(result.current.phase).toBe("idle")
  })
  it("encodes signed little-endian PCM without losing its endpoints", () => {
    const bytes = Uint8Array.from(atob(pcmBase64([new Float32Array([-1, 0, 1])], 3)), (value) => value.charCodeAt(0))
    const view = new DataView(bytes.buffer)
    expect([view.getInt16(0, true), view.getInt16(2, true), view.getInt16(4, true)]).toEqual([-32768, 0, 32767])
  })
  it("releases microphone permissions that resolve after cancellation", async () => {
    let grant!: (stream: MediaStream) => void
    microphone(new Promise((resolve) => { grant = resolve }))
    const stop = vi.fn()
    const { result } = renderHook(() => useVoiceInput("conversation-a", vi.fn()))
    let starting!: Promise<void>
    act(() => { starting = result.current.start() })
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled())
    act(() => result.current.cancel())
    await act(async () => { grant({ getTracks: () => [{ stop }] } as unknown as MediaStream); await starting })
    expect(stop).toHaveBeenCalledOnce()
    expect(result.current.phase).toBe("idle")
    expect(speech.transcribe).not.toHaveBeenCalled()
  })
  it("stops tracks and ignores a transcription result after switching conversations", async () => {
    const stop = vi.fn()
    const track = { stop, onended: null }
    const mic = microphone(Promise.resolve({ getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream))
    let resolveText!: (value: string) => void
    speech.transcribe.mockReturnValue(new Promise((resolve) => { resolveText = resolve }))
    const onText = vi.fn()
    const { result, rerender } = renderHook(({ scope }) => useVoiceInput(scope, onText), { initialProps: { scope: "a" } })
    await act(async () => result.current.start())
    act(() => mic.port.onmessage?.({ data: { samples: new Float32Array(3200).fill(0.25) } }))
    let pending!: Promise<void>
    act(() => { pending = result.current.stop() })
    await waitFor(() => expect(speech.transcribe).toHaveBeenCalledOnce())
    expect(stop).toHaveBeenCalled()
    expect(mic.close).toHaveBeenCalled()
    rerender({ scope: "b" })
    expect(speech.transcribe.mock.calls[0][1].aborted).toBe(true)
    await act(async () => { resolveText("旧对话内容"); await pending })
    expect(onText).not.toHaveBeenCalled()
    expect(result.current.phase).toBe("idle")
  })
})
