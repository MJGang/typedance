import "@testing-library/jest-dom/vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { MouseEvent, ReactNode } from "react"
import { MemoryRouter, useLocation } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ResumeProductsPage } from "./ResumeProductsPage"

type MockNodeProps = {
  children?: ReactNode
}

type MockItemProps = MockNodeProps & {
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void
}

const apiMocks = vi.hoisted(() => ({
  listResumeVersions: vi.fn(),
  deleteResumeVersion: vi.fn(),
  getTemplateStyle: vi.fn(),
  projectLegacyResumeToRevisionWorkspace: vi.fn(),
}))

vi.mock("@/api", () => ({
  listResumeVersions: (...args: unknown[]) => apiMocks.listResumeVersions(...args),
  deleteResumeVersion: (...args: unknown[]) => apiMocks.deleteResumeVersion(...args),
  getTemplateStyle: (...args: unknown[]) => apiMocks.getTemplateStyle(...args),
  projectLegacyResumeToRevisionWorkspace: (...args: unknown[]) =>
    apiMocks.projectLegacyResumeToRevisionWorkspace(...args),
}))

vi.mock("../home/NewResumeModal", () => ({
  NewResumeModal: ({ open }: { open: boolean }) => open ? <div role="dialog">选择模板</div> : null,
}))

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: MockNodeProps) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: MockNodeProps) => <>{children}</>,
  DropdownMenuContent: ({ children }: MockNodeProps) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: MockItemProps) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}))

function LocationProbe() {
  const location = useLocation()
  return <span data-testid="location">{location.pathname}</span>
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/packs/resume/resumes"]}>
      <ResumeProductsPage />
      <LocationProbe />
    </MemoryRouter>,
  )
}

describe("ResumeProductsPage", () => {
  beforeEach(() => {
    apiMocks.listResumeVersions.mockReset()
    apiMocks.deleteResumeVersion.mockReset()
    apiMocks.getTemplateStyle.mockReset()
    apiMocks.projectLegacyResumeToRevisionWorkspace.mockReset()
    apiMocks.getTemplateStyle.mockResolvedValue({
      template_id: "classic-a4",
      name: "经典",
      version: 1,
      page: {},
      typography: {},
      colors: {},
      spacing: {},
      blocks: {},
      updated_at: "2026-05-26T08:00:00.000Z",
    })
    apiMocks.listResumeVersions.mockResolvedValue([
      {
        id: "resume_1",
        title: "张三简历",
        target_language: "zh-CN",
        template_id: "classic-a4",
        plain_text_snapshot: "张三",
        doc_json: { type: "doc", content: [] },
        created_at: "2026-05-26T08:00:00.000Z",
        updated_at: "2026-05-26T08:00:00.000Z",
      },
    ])
    apiMocks.projectLegacyResumeToRevisionWorkspace.mockResolvedValue({
      document: { id: "doc_from_resume" },
    })
  })

  it("lists resume products and opens a product editor", async () => {
    renderPage()

    expect(await screen.findByRole("heading", { name: "简历成品" })).toBeInTheDocument()
    expect(screen.getByText("张三简历")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /张三简历/ }))

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/packs/resume/resumes/resume_1")
    })
  })

  it("opens a new workspace from a resume product", async () => {
    renderPage()

    fireEvent.click(await screen.findByLabelText("打开简历菜单"))
    fireEvent.click(screen.getByText("用新工作台打开"))

    await waitFor(() => expect(apiMocks.projectLegacyResumeToRevisionWorkspace).toHaveBeenCalledWith("resume_1"))
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/packs/resume/workspaces/doc_from_resume")
    })
  })

  it("shows an empty state for resume products", async () => {
    apiMocks.listResumeVersions.mockResolvedValue([])

    renderPage()

    expect(await screen.findByText("还没有简历成品")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "从模板开始" }))
    expect(screen.getByRole("dialog")).toHaveTextContent("选择模板")
  })
})
