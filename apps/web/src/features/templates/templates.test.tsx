import "@testing-library/jest-dom/vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { TooltipProvider } from "@/components/ui/tooltip"
import { describe, expect, it, vi } from "vitest"
import { TemplateLibrary } from "./components/TemplateLibrary"
import { builtInSamples, defaultClassicA4Style } from "./data"

vi.mock("@/api", () => ({
  getTemplateSample: vi.fn(async () => { throw new Error("no local sample"); }),
  getTemplateStyle: vi.fn(async () => { throw new Error("no local style"); }),
  listTemplateStyles: vi.fn(async () => [defaultClassicA4Style]),
  createResumeVersion: vi.fn(),
  deleteTemplateStyle: vi.fn(async () => undefined),
  saveTemplateSample: vi.fn(async () => builtInSamples["sample-tech-zh"]),
  saveTemplateStyle: vi.fn(async () => defaultClassicA4Style),
}))

describe("TemplateLibrary", () => {
  function renderThemeLibrary() {
    return render(
      <MemoryRouter>
        <TooltipProvider>
          <TemplateLibrary uiLanguage="zh-CN" targetLanguage="zh-CN" />
        </TooltipProvider>
      </MemoryRouter>,
    )
  }

  function clickButtonText(label: string | RegExp) {
    const button = Array.from(document.querySelectorAll("button"))
      .find((element) => (
        typeof label === "string"
          ? element.textContent?.trim() === label
          : label.test(element.textContent ?? "")
      ))
    if (!button) throw new Error(`No button found for ${String(label)}`)
    fireEvent.click(button)
  }

  it("renders theme cards and opens theme detail", async () => {
    renderThemeLibrary()
    expect(await screen.findByRole("heading", { name: "主题库" })).toBeInTheDocument()
    clickButtonText(/经典 A4/)
    expect(screen.getByText("返回主题库")).toBeInTheDocument()
    expect(screen.getByLabelText("主题演示简历预览")).toBeInTheDocument()
    expect(screen.getByText("主题样式")).toBeInTheDocument()
  })

  it("filters custom and default themes", async () => {
    renderThemeLibrary()
    expect(await screen.findByRole("heading", { name: "主题库" })).toBeInTheDocument()
    clickButtonText("官方")
    expect(screen.getByText(/经典 A4/)).toBeInTheDocument()
  })

})
