import "@testing-library/jest-dom/vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SpeechSettingsPanel } from "./SpeechSettingsPanel"

const speech = vi.hoisted(() => ({ status: vi.fn(), configure: vi.fn(), prepare: vi.fn() }))
vi.mock("@/agentHost", () => ({ getSpeechStatus: speech.status, configureSpeech: speech.configure, prepareSpeech: speech.prepare }))
const status = { language: "auto", download_origin: "https://hf-mirror.com", phase: "unprepared", completed_bytes: 0, total_bytes: 241347257 }
beforeEach(() => { vi.clearAllMocks(); speech.status.mockResolvedValue(status); speech.configure.mockResolvedValue(status); speech.prepare.mockResolvedValue({ ...status, phase: "downloading" }) })
describe("local speech settings", () => {
  it("starts an explicit model download only after saving the selected preferences", async () => {
    render(<SpeechSettingsPanel />)
    fireEvent.click(await screen.findByRole("button", { name: "下载本地模型" }))
    await waitFor(() => expect(speech.prepare).toHaveBeenCalledWith(false))
    expect(speech.configure).toHaveBeenCalledWith({ language: "auto", download_origin: "https://hf-mirror.com" })
    expect(speech.configure.mock.invocationCallOrder[0]).toBeLessThan(speech.prepare.mock.invocationCallOrder[0])
  })
  it("lets the user retry a failed settings read", async () => {
    speech.status.mockRejectedValueOnce(new Error("offline"))
    render(<SpeechSettingsPanel />)
    fireEvent.click(await screen.findByRole("button", { name: /^重试$/ }))
    expect(await screen.findByRole("button", { name: "下载本地模型" })).toBeEnabled()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })
})
