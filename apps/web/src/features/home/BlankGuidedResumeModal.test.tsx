import "@testing-library/jest-dom/vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, useLocation } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BlankGuidedResumeModal } from "./BlankGuidedResumeModal"

const apiMocks = vi.hoisted(() => ({
  startBlankGuidedResume: vi.fn(),
}))

vi.mock("@/api", () => ({
  startBlankGuidedResume: (...args: unknown[]) => apiMocks.startBlankGuidedResume(...args),
}))

function LocationProbe() {
  const location = useLocation()
  return <span data-testid="location">{location.pathname}</span>
}

function renderModal(onOpenChange = vi.fn()) {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <BlankGuidedResumeModal open onOpenChange={onOpenChange} />
      <LocationProbe />
    </MemoryRouter>,
  )
  return { onOpenChange }
}

describe("BlankGuidedResumeModal", () => {
  beforeEach(() => {
    apiMocks.startBlankGuidedResume.mockReset()
    apiMocks.startBlankGuidedResume.mockResolvedValue({
      document: { id: "doc_guided" },
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("requires at least one guided signal", async () => {
    renderModal()

    fireEvent.click(screen.getByRole("button", { name: "生成初稿" }))

    expect(await screen.findByText("请至少填写一个基础线索。")).toBeInTheDocument()
    expect(apiMocks.startBlankGuidedResume).not.toHaveBeenCalled()
  })

  it("starts a blank guided workspace", async () => {
    const { onOpenChange } = renderModal()

    fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "张三简历" } })
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "张三" } })
    fireEvent.change(screen.getByLabelText("目标方向"), { target: { value: "前端工程师" } })
    fireEvent.change(screen.getByLabelText("技能"), { target: { value: "Vue3、TypeScript" } })
    fireEvent.click(screen.getByRole("button", { name: "生成初稿" }))

    await waitFor(() => {
      expect(apiMocks.startBlankGuidedResume).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "张三简历",
          name: "张三",
          target_role: "前端工程师",
          skills: "Vue3、TypeScript",
        }),
      )
    })
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/revision/doc_guided")
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
