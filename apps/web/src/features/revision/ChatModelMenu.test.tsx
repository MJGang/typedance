import "@testing-library/jest-dom/vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ModelSelection } from "@typedance/contracts"
import { getModelSelection, updateModelSelection } from "@/agentHost"
import { ChatModelMenu } from "./ChatModelMenu"

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
    const changed = vi.fn()
    render(<ChatModelMenu disabled={false} onChange={changed} />)
    const trigger = await screen.findByRole("button", { name: /当前 DeepSeek-V4.1-Flash，推理强度 High/ })
    fireEvent.keyDown(trigger, { key: "Enter" })
    fireEvent.click(await screen.findByRole("menuitem", { name: /推理强度 High/ }))
    fireEvent.click(await screen.findByRole("menuitemradio", { name: effort[0].toUpperCase() + effort.slice(1) }))
    await waitFor(() => expect(updateModelSelection).toHaveBeenCalledWith({ model: "deepseek-flash", reasoning_effort: effort }))
    expect(await screen.findByRole("button", { name: new RegExp(`推理强度 ${effort[0].toUpperCase() + effort.slice(1)}`) })).toBeInTheDocument()
  })
  it("selects the concrete Pro model and freezes selection during execution", async () => {
    const changed = vi.fn()
    const view = render(<ChatModelMenu disabled={false} onChange={changed} />)
    fireEvent.keyDown(await screen.findByRole("button", { name: /当前 DeepSeek-V4.1-Flash/ }), { key: "Enter" })
    fireEvent.click(await screen.findByRole("menuitem", { name: /模型 DeepSeek-V4.1-Flash/ }))
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "DeepSeek-V4-Pro" }))
    await waitFor(() => expect(updateModelSelection).toHaveBeenCalledWith({ model: "deepseek-v4-pro", reasoning_effort: "high" }))
    await screen.findByRole("button", { name: /当前 DeepSeek-V4-Pro/ })
    view.rerender(<ChatModelMenu disabled onChange={changed} />)
    expect(screen.getByRole("button", { name: /当前 DeepSeek-V4-Pro/ })).toBeDisabled()
  })
});
