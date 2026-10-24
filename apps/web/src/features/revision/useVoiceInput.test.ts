import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { pcmBase64, useVoiceInput } from "./useVoiceInput"

const speech = vi.hoisted(() => ({ status: vi.fn(), transcribe: vi.fn() }))
vi.mock("@/agentHost", () => ({ getSpeechStatus: speech.status, transcribeSpeech: speech.transcribe }))

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); speech.status.mockReset(); speech.transcribe.mockReset() })
function microphone(permission: Promise<MediaStream>) {
  const port: { onmessage: ((event: unknown) => void) | null; postMessage: ReturnType<typeof vi.fn> } = { onmessage: null, postMessage: vi.fn() }
  port.postMessage.mockImplementation(() => queueMicrotask(() => port.onmessage?.({ data: { flushed: true } })))
  const close = vi.fn().mockResolvedValue(undefined)
  const disconnect = vi.fn()
  vi.stubGlobal("AudioContext", class {
    sampleRate = 16000
    state = "running"
    destination = {}
    audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) }
    createMediaStreamSource() { return { connect: vi.fn() } }
    createGain() { return { gain: { value: 1 }, connect: vi.fn() } }
    resume = vi.fn().mockResolvedValue(undefined)
    close = close
  })
  vi.stubGlobal("AudioWorkletNode", class { port = port; connect = vi.fn(); disconnect = disconnect })
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn().mockReturnValue(permission) } })
  speech.status.mockResolvedValue({ phase: "ready" })
  return { port, close, disconnect }
}

describe("voice input", () => {
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
