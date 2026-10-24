import "@testing-library/jest-dom/vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getMicrophoneChoice, saveMicrophoneChoice } from "@/lib/microphone"
import { MicrophoneSettingsPanel } from "./MicrophoneSettingsPanel"

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear() })
function fixture() {
  const track = { stop: vi.fn(), onended: null as (() => void) | null }
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream
  const close = vi.fn().mockResolvedValue(undefined)
  const media = Object.assign(new EventTarget(), {
    enumerateDevices: vi.fn().mockResolvedValue([{ deviceId: "usb-mic", kind: "audioinput", label: "USB 麦克风", groupId: "usb" }] as MediaDeviceInfo[]),
    getUserMedia: vi.fn().mockResolvedValue(stream),
  })
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: media })
  vi.stubGlobal("AudioContext", class {
    state = "running"
    close = close
    resume = vi.fn().mockResolvedValue(undefined)
    createAnalyser() { return { fftSize: 256, getFloatTimeDomainData: (data: Float32Array) => data.fill(.05) } }
    createMediaStreamSource() { return { connect: vi.fn() } }
  })
  return { media, track, stream, close }
}

describe("microphone settings", () => {
  it("does not cancel a pending permission grant because the device list is still empty", async () => {
    const { media, stream } = fixture()
    let grant!: (value: MediaStream) => void
    media.getUserMedia.mockReturnValue(new Promise((resolve) => { grant = resolve }))
    media.enumerateDevices.mockResolvedValue([])
    render(<MicrophoneSettingsPanel />)
    fireEvent.click(screen.getByRole("button", { name: "测试麦克风" }))
    act(() => media.dispatchEvent(new Event("devicechange")))
    await act(async () => {})
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    media.enumerateDevices.mockResolvedValue([{ deviceId: "usb-mic", kind: "audioinput", label: "USB 麦克风", groupId: "usb" }] as MediaDeviceInfo[])
    await act(async () => grant(stream))
    expect(await screen.findByRole("progressbar", { name: "麦克风输入音量" })).toBeInTheDocument()
  })
  it("saves an explicit device selection without acquiring the microphone", async () => {
    const { media } = fixture()
    render(<MicrophoneSettingsPanel />)
    await waitFor(() => expect(media.enumerateDevices).toHaveBeenCalled())
    fireEvent.click(screen.getByRole("combobox", { name: "录音设备" }))
    const option = await screen.findByRole("option", { name: "USB 麦克风" })
    await act(async () => fireEvent.click(option))
    expect(getMicrophoneChoice()).toEqual({ id: "usb-mic", label: "USB 麦克风" })
    expect(media.getUserMedia).not.toHaveBeenCalled()
  })
  it("only previews on request and releases its tracks and context when the panel closes", async () => {
    const { media, track, close } = fixture()
    const { unmount } = render(<MicrophoneSettingsPanel />)
    expect(media.getUserMedia).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "测试麦克风" }))
    expect(await screen.findByRole("progressbar", { name: "麦克风输入音量" })).toBeInTheDocument()
    unmount()
    expect(track.stop).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })
  it("releases a microphone permission grant that arrives after the panel closes", async () => {
    const { media, track, stream } = fixture()
    let grant!: (value: MediaStream) => void
    media.getUserMedia.mockReturnValue(new Promise((resolve) => { grant = resolve }))
    const { unmount } = render(<MicrophoneSettingsPanel />)
    fireEvent.click(screen.getByRole("button", { name: "测试麦克风" }))
    unmount()
    await act(async () => grant(stream))
    expect(track.stop).toHaveBeenCalledOnce()
  })
  it("stops preview when the page is hidden without reacquiring it on return", async () => {
    const { media, track } = fixture()
    render(<MicrophoneSettingsPanel />)
    fireEvent.click(screen.getByRole("button", { name: "测试麦克风" }))
    await screen.findByRole("progressbar", { name: "麦克风输入音量" })
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true)
    act(() => document.dispatchEvent(new Event("visibilitychange")))
    expect(track.stop).toHaveBeenCalledOnce()
    hidden.mockReturnValue(false)
    act(() => document.dispatchEvent(new Event("visibilitychange")))
    await waitFor(() => expect(media.enumerateDevices).toHaveBeenCalled())
    expect(media.getUserMedia).toHaveBeenCalledOnce()
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
  })
  it("keeps a disconnected selection visible and does not silently switch to another input", async () => {
    saveMicrophoneChoice({ id: "usb-mic", label: "USB 麦克风" })
    const { media, track } = fixture()
    render(<MicrophoneSettingsPanel />)
    fireEvent.click(screen.getByRole("button", { name: "测试麦克风" }))
    await screen.findByRole("progressbar", { name: "麦克风输入音量" })
    media.enumerateDevices.mockResolvedValue([])
    act(() => media.dispatchEvent(new Event("devicechange")))
    expect(await screen.findByRole("alert")).toHaveTextContent("已断开")
    expect(screen.getByRole("combobox", { name: "录音设备" })).toHaveTextContent("USB 麦克风（已不可用）")
    expect(track.stop).toHaveBeenCalledOnce()
    expect(media.getUserMedia).toHaveBeenCalledOnce()
    expect(getMicrophoneChoice().id).toBe("usb-mic")
  })
  it("does not infer that an explicitly selected device disappeared just because labels are hidden", async () => {
    saveMicrophoneChoice({ id: "usb-mic", label: "USB 麦克风" })
    const { media } = fixture()
    media.enumerateDevices.mockResolvedValue([{ deviceId: "", kind: "audioinput", label: "", groupId: "" }] as MediaDeviceInfo[])
    render(<MicrophoneSettingsPanel />)
    await waitFor(() => expect(screen.getByRole("combobox", { name: "录音设备" })).toHaveTextContent("授权后确认"))
    fireEvent.click(screen.getByRole("button", { name: "测试麦克风" }))
    await screen.findByRole("progressbar", { name: "麦克风输入音量" })
    expect(media.getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: expect.objectContaining({ deviceId: { exact: "usb-mic" } }) }))
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })
})
