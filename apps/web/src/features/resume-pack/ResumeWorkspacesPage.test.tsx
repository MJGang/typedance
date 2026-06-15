import "@testing-library/jest-dom/vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, useLocation } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ResumeWorkspacesPage } from "./ResumeWorkspacesPage"

const apiMocks = vi.hoisted(() => ({
  deleteRevisionDocument: vi.fn(),
  listRevisionDocuments: vi.fn(),
}))

vi.mock("@/api", () => ({
  deleteRevisionDocument: (...args: unknown[]) => apiMocks.deleteRevisionDocument(...args),
  listRevisionDocuments: (...args: unknown[]) => apiMocks.listRevisionDocuments(...args),
}))

vi.mock("../home/ImportOldResumeModal", () => ({
  ImportOldResumeModal: ({ open }: { open: boolean }) => (open ? <div role="dialog">导入旧简历弹窗</div> : null),
}))

vi.mock("../home/BlankGuidedResumeModal", () => ({
  BlankGuidedResumeModal: ({ open }: { open: boolean }) => (open ? <div role="dialog">新建简历弹窗</div> : null),
}))

function LocationProbe() {
  const location = useLocation()
  return <span data-testid="location">{location.pathname}</span>
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/packs/resume/workspaces"]}>
      <TooltipProvider>
        <ResumeWorkspacesPage />
        <LocationProbe />
      </TooltipProvider>
    </MemoryRouter>,
  )
}

describe("ResumeWorkspacesPage", () => {
  beforeEach(() => {
    apiMocks.deleteRevisionDocument.mockReset()
    apiMocks.deleteRevisionDocument.mockResolvedValue(undefined)
    apiMocks.listRevisionDocuments.mockReset()
    apiMocks.listRevisionDocuments.mockResolvedValue([
      {
        id: "doc_1",
        pack_id: "resume",
        title: "旧简历重构",
        status: "active",
        target_language: "zh-CN",
        current_draft_id: "draft_1",
        updated_at: "2026-05-26T08:00:00.000Z",
        quality_state: "needs_review",
      },
      {
        id: "doc_cover_letter",
        pack_id: "cover-letter",
        title: "求职信工作台",
        status: "active",
        target_language: "zh-CN",
        current_draft_id: "draft_cover_letter",
        updated_at: "2026-05-26T08:30:00.000Z",
        quality_state: "ready",
      },
    ])
  })

  it("lists revision workspaces and opens a workspace", async () => {
    renderPage()

    expect(await screen.findByRole("heading", { name: "工作台" })).toBeInTheDocument()
    expect(screen.getByText("旧简历重构")).toBeInTheDocument()
    expect(screen.getByText("需检查")).toBeInTheDocument()
    expect(screen.queryByText("求职信工作台")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /打开旧简历重构/ }))

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/packs/resume/workspaces/doc_1")
    })
  })

  it("opens import and blank guided modals", async () => {
    renderPage()

    fireEvent.click(await screen.findByRole("button", { name: "导入旧简历" }))
    expect(screen.getByRole("dialog")).toHaveTextContent("导入旧简历弹窗")

    fireEvent.click(screen.getByRole("button", { name: "新建简历" }))
    expect(screen.getByRole("dialog")).toHaveTextContent("新建简历弹窗")
  })

  it("deletes a workspace after confirmation", async () => {
    renderPage()

    fireEvent.click(await screen.findByRole("button", { name: "删除旧简历重构" }))
    expect(screen.getByRole("dialog", { name: "删除「旧简历重构」？" })).toHaveTextContent(
      "删除后无法恢复",
    )

    fireEvent.click(screen.getByRole("button", { name: "删除工作台" }))

    await waitFor(() => {
      expect(apiMocks.deleteRevisionDocument).toHaveBeenCalledWith("doc_1")
    })
    await waitFor(() => {
      expect(screen.queryByText("旧简历重构")).not.toBeInTheDocument()
    })
  })

  it("keeps the workspace when deletion fails", async () => {
    apiMocks.deleteRevisionDocument.mockRejectedValueOnce(new Error("network"))
    renderPage()

    fireEvent.click(await screen.findByRole("button", { name: "删除旧简历重构" }))
    fireEvent.click(screen.getByRole("button", { name: "删除工作台" }))

    await waitFor(() => {
      expect(apiMocks.deleteRevisionDocument).toHaveBeenCalledWith("doc_1")
    })
    expect(screen.getByText("旧简历重构")).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "删除工作台" })).not.toBeDisabled()
    })
  })

  it("shows an empty state", async () => {
    apiMocks.listRevisionDocuments.mockResolvedValue([])

    renderPage()

    expect(await screen.findByText("还没有工作台")).toBeInTheDocument()
    expect(screen.getByText("导入旧简历或新建简历来开始改稿。")).toBeInTheDocument()
  })

  it("shows an error state with retry", async () => {
    apiMocks.listRevisionDocuments.mockRejectedValueOnce(new Error("network"))
    apiMocks.listRevisionDocuments.mockResolvedValueOnce([])

    renderPage()

    expect(await screen.findByText("工作台加载失败")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "重试" }))

    await waitFor(() => expect(apiMocks.listRevisionDocuments).toHaveBeenCalledTimes(2))
  })
})
