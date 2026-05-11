import "@testing-library/jest-dom/vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { TemplateLibrary } from "./components/TemplateLibrary"
import { builtInSamples, defaultClassicA4Style } from "./data"

vi.mock("@/api", () => ({
  getTemplateSample: vi.fn(async () => { throw new Error("no local sample"); }),
  getTemplateStyle: vi.fn(async () => { throw new Error("no local style"); }),
  saveTemplateSample: vi.fn(async () => builtInSamples["sample-tech-zh"]),
  saveTemplateStyle: vi.fn(async () => defaultClassicA4Style),
}))

describe("TemplateLibrary", () => {
  it("renders template cards and opens template detail", async () => {
    render(<TemplateLibrary uiLanguage="zh-CN" targetLanguage="zh-CN" />)
    expect(await screen.findByRole("heading", { name: "模板库" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /经典 A4/ }))
    expect(screen.getByText("classic-a4")).toBeInTheDocument()
    expect(screen.getByLabelText("A4 template sample preview")).toBeInTheDocument()
  })

  it("saves sample content", async () => {
    render(<TemplateLibrary uiLanguage="zh-CN" targetLanguage="zh-CN" />)
    fireEvent.click(screen.getByRole("tab", { name: "样张内容" }))
    expect(await screen.findByRole("heading", { name: "样张内容" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "保存样张" }))
    await waitFor(() => expect(screen.getByText("样张已保存")).toBeInTheDocument())
  })
})
