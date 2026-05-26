import "@testing-library/jest-dom/vitest"
import { afterEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { SettingsPage } from "./SettingsPage"

const basePayload = {
  config_path: "C:/Users/test/.typedance/config.toml",
  auth_path: "C:/Users/test/.typedance/auth.json",
  model: {
    provider: "deepseek",
    model: "deepseek-v4-flash",
    base_url: "https://api.deepseek.com",
    temperature: 0,
    timeout_seconds: 120,
    structured_output: true,
  },
  agents: {
    parser: "auto",
    structurer: "auto",
    reviewer: "auto",
    rewriter: "auto",
    opportunity_calibrator: "auto",
  },
  api_key: {
    configured: true,
    source: "auth_json",
    preview: "...a9f2",
  },
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("SettingsPage", () => {
  it("loads and displays model settings without exposing the full key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(basePayload))))

    render(<SettingsPage />)

    expect(await screen.findByDisplayValue("deepseek-v4-flash")).toBeInTheDocument()
    expect(screen.getByText("已配置 ...a9f2")).toBeInTheDocument()
    expect(screen.queryByText(/sk-/)).not.toBeInTheDocument()
  })

  it("saves edited model settings", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(basePayload))))

    render(<SettingsPage />)

    const modelInput = await screen.findByLabelText("模型")
    fireEvent.change(modelInput, { target: { value: "deepseek-v4-pro" } })
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "http://127.0.0.1:4317/settings/model",
        expect.objectContaining({ method: "PUT" }),
      )
    })
  })
})
