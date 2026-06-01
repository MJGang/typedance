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

    expect(await screen.findByText("请粘贴简历内容或选择一个文件。")).toBeInTheDocument()
    expect(apiMocks.importOldResume).not.toHaveBeenCalled()
  })

  it("keeps long pasted resume content scrollable inside the modal", () => {
    renderModal()

    expect(screen.getByText("系统会保留原始简历内容，并生成可直接编辑的工作台。")).toBeInTheDocument()
    expect(screen.getByRole("dialog")).toHaveClass("max-h-[calc(100svh-2rem)]", "overflow-y-auto")
    expect(screen.getByLabelText("旧简历内容")).toHaveClass(
      "field-sizing-fixed",
      "h-80",
      "max-h-[45svh]",
      "overflow-y-auto",
    )
    expect(screen.getByLabelText("旧简历内容")).not.toHaveClass("field-sizing-content")
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
      }, expect.any(Function))
    })
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/packs/resume/workspaces/doc_import")
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("imports a selected resume file and hides pasted content area", async () => {
    const { onOpenChange } = renderModal()
    const file = new File(["项目经历\n负责订单系统重构"], "resume.md", { type: "text/markdown" })

    fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "张三旧简历" } })
    fireEvent.change(screen.getByLabelText("选择旧简历文件"), { target: { files: [file] } })

    expect(screen.getByText("resume.md")).toBeInTheDocument()
    expect(screen.queryByLabelText("旧简历内容")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "生成改稿工作台" }))

    await waitFor(() => {
      expect(apiMocks.importOldResume).toHaveBeenCalledWith({
        title: "张三旧简历",
        file,
      }, expect.any(Function))
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("hides file selection area after pasted content is entered", () => {
    renderModal()

    fireEvent.change(screen.getByLabelText("旧简历内容"), {
      target: { value: "项目经历\n负责订单系统重构" },
    })

    expect(screen.queryByLabelText("选择旧简历文件")).not.toBeInTheDocument()
  })

  it("shows staged import progress while submitting", async () => {
    let resolveImport: (value: { document: { id: string } }) => void = () => {}
    apiMocks.importOldResume.mockImplementation(
      (_input, onProgress?: (step: string) => void) => new Promise((resolve) => {
        resolveImport = resolve
        onProgress?.("create_document")
        onProgress?.("save_source")
        onProgress?.("run_import")
      }),
    )
    renderModal()

    fireEvent.change(screen.getByLabelText("旧简历内容"), { target: { value: "张三" } })
    fireEvent.click(screen.getByRole("button", { name: "生成改稿工作台" }))

    expect(await screen.findByText("正在准备可编辑工作台")).toBeInTheDocument()
    expect(screen.getByText("创建工作台")).toBeInTheDocument()
    expect(screen.getByText("保存旧简历")).toBeInTheDocument()
    expect(screen.getByText("解析原文、生成画布并识别模块")).toBeInTheDocument()

    resolveImport({ document: { id: "doc_import" } })
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/packs/resume/workspaces/doc_import")
    })
  })
})
