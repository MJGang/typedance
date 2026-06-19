import "@testing-library/jest-dom/vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AiSettingsDialog } from "./AiSettingsDialog"

const agentHostMocks = vi.hoisted(() => ({
  clearModelApiKey: vi.fn(),
  getModelSettings: vi.fn(),
  updateModelSettings: vi.fn(),
}))

vi.mock("@/agentHost", () => ({
  clearModelApiKey: (...args: unknown[]) => agentHostMocks.clearModelApiKey(...args),
  getModelSettings: (...args: unknown[]) => agentHostMocks.getModelSettings(...args),
  updateModelSettings: (...args: unknown[]) => agentHostMocks.updateModelSettings(...args),
}))

const configuredSettings = {
  provider: "deepseek" as const,
  model: "deepseek-v4-flash",
  base_url: "https://api.deepseek.com",
  api_key: { configured: true, preview: "...a9f2" },
}

describe("AiSettingsDialog", () => {
  beforeEach(() => {
    Object.values(agentHostMocks).forEach((mock) => mock.mockReset())
    agentHostMocks.getModelSettings.mockResolvedValue(configuredSettings)
    agentHostMocks.updateModelSettings.mockResolvedValue(configuredSettings)
    agentHostMocks.clearModelApiKey.mockResolvedValue({
      ...configuredSettings,
      api_key: { configured: false, preview: null },
    })
  })

  it("loads redacted settings and saves a replacement API key", async () => {
    render(<AiSettingsDialog open onOpenChange={() => undefined} />)

    expect(await screen.findByText("已配置 ...a9f2")).toBeInTheDocument()
    expect(screen.getByLabelText("模型")).toHaveValue("deepseek-v4-flash")
    expect(screen.getByLabelText("Base URL")).toHaveValue("https://api.deepseek.com")
    expect(screen.getByLabelText("API Key")).toHaveValue("")

    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "sk-new" } })
    fireEvent.click(screen.getByRole("button", { name: "保存" }))

    await waitFor(() => expect(agentHostMocks.updateModelSettings).toHaveBeenCalledWith({
      model: "deepseek-v4-flash",
      base_url: "https://api.deepseek.com",
      api_key: "sk-new",
    }))
    expect(screen.getByLabelText("API Key")).toHaveValue("")
  })

  it("requires confirmation before clearing the configured API key", async () => {
    render(<AiSettingsDialog open onOpenChange={() => undefined} />)
    await screen.findByText("已配置 ...a9f2")

    fireEvent.click(screen.getByRole("button", { name: "清除密钥" }))
    expect(agentHostMocks.clearModelApiKey).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "确认清除" }))

    await waitFor(() => expect(agentHostMocks.clearModelApiKey).toHaveBeenCalledTimes(1))
  })
})
