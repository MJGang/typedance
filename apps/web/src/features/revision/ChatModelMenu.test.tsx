import "@testing-library/jest-dom/vitest"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ModelSelection } from "@typedance/contracts"
import { getModelSelection, updateModelSelection } from "@/agentHost"
import { ChatModelMenu } from "./ChatModelMenu"
import { notifyModelSettingsChanged } from "@/modelSettingsEvents"

vi.mock("@/agentHost", () => ({ getModelSelection: vi.fn(), updateModelSelection: vi.fn() }))
const selection: ModelSelection = { model: "deepseek-flash", reasoning_effort: "high", models: [
  { id: "deepseek-flash", name: "DeepSeek-V4.1-Flash", context_window: 1_000_000, reasoning_efforts: ["off", "low", "high", "max"] },
  { id: "deepseek-v4-pro", name: "DeepSeek-V4-Pro", context_window: 1_000_000, reasoning_efforts: ["off", "low", "high", "max"] },
] }

describe("chat model selection", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(getModelSelection).mockResolvedValue(selection)
    vi.mocked(updateModelSelection).mockImplementation(async (input) => ({ ...selection, ...input }))
  })
  it.each(["off", "low", "max"])("selects %s by clicking within the same menu", async (effort) => {
    render(<ChatModelMenu disabled={false} />)
    const trigger = await screen.findByRole("button", { name: /当前 DeepSeek-V4.1-Flash，推理强度 High/ })
    fireEvent.keyDown(trigger, { key: "Enter" })
    fireEvent.click(await screen.findByRole("menuitem", { name: /推理强度 High/ }))
    fireEvent.click(await screen.findByRole("menuitemradio", { name: effort[0].toUpperCase() + effort.slice(1) }))
    await waitFor(() => expect(updateModelSelection).toHaveBeenCalledWith({ model: "deepseek-flash", reasoning_effort: effort }))
    expect(await screen.findByRole("button", { name: new RegExp(`推理强度 ${effort[0].toUpperCase() + effort.slice(1)}`) })).toBeInTheDocument()
  })
  it("selects the concrete Pro model and freezes selection during execution", async () => {
    const view = render(<ChatModelMenu disabled={false} />)
    fireEvent.keyDown(await screen.findByRole("button", { name: /当前 DeepSeek-V4.1-Flash/ }), { key: "Enter" })
    fireEvent.click(await screen.findByRole("menuitem", { name: /模型 DeepSeek-V4.1-Flash/ }))
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "DeepSeek-V4-Pro" }))
    await waitFor(() => expect(updateModelSelection).toHaveBeenCalledWith({ model: "deepseek-v4-pro", reasoning_effort: "high" }))
    await screen.findByRole("button", { name: /当前 DeepSeek-V4-Pro/ })
    view.rerender(<ChatModelMenu disabled />)
    expect(screen.getByRole("button", { name: /当前 DeepSeek-V4-Pro/ })).toBeDisabled()
  })
  it("refreshes the displayed selection after the settings form saves without opening the menu", async () => {
    render(<ChatModelMenu disabled={false} />)
    await screen.findByRole("button", { name: /当前 DeepSeek-V4.1-Flash/ })
    vi.mocked(getModelSelection).mockResolvedValue({ ...selection, model: "deepseek-v4-pro", reasoning_effort: "low" })
    act(() => notifyModelSettingsChanged())
    expect(await screen.findByRole("button", { name: /当前 DeepSeek-V4-Pro，推理强度 Low/ })).toBeInTheDocument()
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
  })
});
