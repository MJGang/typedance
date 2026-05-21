import "@testing-library/jest-dom/vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OpportunityCalibrationModal } from "./OpportunityCalibrationModal"

const apiMocks = vi.hoisted(() => ({
  calibrateRevisionOpportunity: vi.fn(),
}))

vi.mock("@/api", () => ({
  calibrateRevisionOpportunity: (...args: unknown[]) => apiMocks.calibrateRevisionOpportunity(...args),
}))

function renderModal(onCompleted = vi.fn()) {
  const onOpenChange = vi.fn()
  render(
    <MemoryRouter>
      <OpportunityCalibrationModal
        documentId="doc_1"
        baseDraftId="draft_1"
        open
        onOpenChange={onOpenChange}
        onCompleted={onCompleted}
      />
    </MemoryRouter>,
  )
  return { onOpenChange, onCompleted }
}

describe("OpportunityCalibrationModal", () => {
  beforeEach(() => {
    apiMocks.calibrateRevisionOpportunity.mockReset()
    apiMocks.calibrateRevisionOpportunity.mockResolvedValue({ document: { id: "doc_1" } })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("requires opportunity content", async () => {
    renderModal()

    fireEvent.click(screen.getByRole("button", { name: "生成岗位版本" }))

    expect(await screen.findByText("请先粘贴岗位信息。")).toBeInTheDocument()
    expect(apiMocks.calibrateRevisionOpportunity).not.toHaveBeenCalled()
  })

  it("calibrates the current draft against opportunity content", async () => {
    const onCompleted = vi.fn()
    const { onOpenChange } = renderModal(onCompleted)

    fireEvent.change(screen.getByLabelText("岗位名称"), { target: { value: "前端岗位" } })
    fireEvent.change(screen.getByLabelText("岗位信息"), {
      target: { value: "要求：React、TypeScript、Node.js" },
    })
    fireEvent.click(screen.getByRole("button", { name: "生成岗位版本" }))

    await waitFor(() => {
      expect(apiMocks.calibrateRevisionOpportunity).toHaveBeenCalledWith("doc_1", "draft_1", {
        title: "前端岗位",
        raw_text: "要求：React、TypeScript、Node.js",
      })
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onCompleted).toHaveBeenCalled()
  })
})
