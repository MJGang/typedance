import "@testing-library/jest-dom/vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, useLocation } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ImportOldResumeModal } from "./ImportOldResumeModal"

const apiMocks = vi.hoisted(() => ({
  importOldResume: vi.fn(),
}))

vi.mock("@/api", () => ({
  importOldResume: (...args: unknown[]) => apiMocks.importOldResume(...args),
}))

function LocationProbe() {
  const location = useLocation()
  return <span data-testid="location">{location.pathname}</span>
}

function renderModal(onOpenChange = vi.fn()) {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <ImportOldResumeModal open onOpenChange={onOpenChange} />
      <LocationProbe />
    </MemoryRouter>,
  )
  return { onOpenChange }
}

describe("ImportOldResumeModal", () => {
  beforeEach(() => {
    apiMocks.importOldResume.mockReset()
    apiMocks.importOldResume.mockResolvedValue({
      document: { id: "doc_import" },
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("requires pasted resume content", async () => {
    renderModal()

    fireEvent.click(screen.getByRole("button", { name: "生成改稿工作台" }))

    expect(await screen.findByText("请先粘贴旧简历内容。")).toBeInTheDocument()
    expect(apiMocks.importOldResume).not.toHaveBeenCalled()
  })

  it("imports pasted content and enters revision workspace", async () => {
    const { onOpenChange } = renderModal()

    fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "张三旧简历" } })
    fireEvent.change(screen.getByLabelText("旧简历内容"), {
      target: { value: "项目经历\n负责订单系统重构" },
    })
    fireEvent.click(screen.getByRole("button", { name: "生成改稿工作台" }))

    await waitFor(() => {
      expect(apiMocks.importOldResume).toHaveBeenCalledWith({
        title: "张三旧简历",
        raw_text: "项目经历\n负责订单系统重构",
      })
    })
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/revision/doc_import")
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
