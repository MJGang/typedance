import "@testing-library/jest-dom/vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, useLocation } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createBlankResume, importOldResume } from "@/api"
import { CreateResumeDialog } from "./CreateResumeDialog"

vi.mock("@/api", () => ({ createBlankResume: vi.fn(), importOldResume: vi.fn() }))

function LocationProbe() { return <span data-testid="location">{useLocation().pathname}</span> }
function setup() {
  const onClose = vi.fn()
  const onCreated = vi.fn()
  render(<MemoryRouter><CreateResumeDialog onClose={onClose} onCreated={onCreated} /><LocationProbe /></MemoryRouter>)
  return { onClose, onCreated }
}
function chooseImport() { fireEvent.click(screen.getByRole("radio", { name: "导入已有简历" })) }
function chooseText() { fireEvent.mouseDown(screen.getByRole("tab", { name: "粘贴文本" }), { button: 0, ctrlKey: false }) }
function chooseFile() { fireEvent.mouseDown(screen.getByRole("tab", { name: "上传文件" }), { button: 0, ctrlKey: false }) }
function upload(file = new File(["# 项目经历\n负责知识库问答"], "我的简历.md")) {
  fireEvent.change(screen.getByLabelText("选择简历文件"), { target: { files: [file] } })
  return file
}

describe("CreateResumeDialog", () => {
  beforeEach(() => {
    vi.mocked(createBlankResume).mockResolvedValue({ document: { id: "doc_blank" } } as never)
    vi.mocked(importOldResume).mockResolvedValue({ document: { id: "doc_import" } } as never)
  })
  afterEach(() => { cleanup(); vi.resetAllMocks() })

  it("creates an editable blank resume with only a name and opens it", async () => {
    const { onClose, onCreated } = setup()
    expect(screen.getAllByRole("radio")).toHaveLength(2)
    expect(screen.getAllByRole("textbox")).toHaveLength(1)
    expect(screen.queryByRole("img")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "创建并打开" }))
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/workspaces/doc_blank"))
    expect(createBlankResume).toHaveBeenCalledWith({ title: "未命名简历" })
    expect(importOldResume).not.toHaveBeenCalled()
    expect(onCreated).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("does not create anything when cancelled", () => {
    const { onClose } = setup()
    fireEvent.click(screen.getByRole("button", { name: "取消" }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(createBlankResume).not.toHaveBeenCalled()
    expect(importOldResume).not.toHaveBeenCalled()
  })

  it("keeps blank and import names independent when switching creation modes", () => {
    setup()
    fireEvent.change(screen.getByLabelText("简历名称"), { target: { value: "空白草稿" } })
    chooseImport()
    upload()
    expect(screen.getByLabelText("简历名称")).toHaveValue("我的简历")
    fireEvent.click(screen.getByRole("radio", { name: "空白简历" }))
    expect(screen.getByLabelText("简历名称")).toHaveValue("空白草稿")
    chooseImport()
    expect(screen.getByLabelText("简历名称")).toHaveValue("我的简历")
    expect(screen.getByText("我的简历.md")).toBeInTheDocument()
  })

  it("requires the selected source and imports only the active source while retaining both inputs", async () => {
    setup()
    chooseImport()
    expect(screen.getByRole("button", { name: "导入并打开" })).toBeDisabled()
    const file = upload()
    chooseText()
    expect(screen.getByRole("button", { name: "导入并打开" })).toBeDisabled()
    expect(screen.queryByTestId("resume-file-dropzone")).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("简历内容"), { target: { value: "项目经历\n负责订单系统重构" } })
    chooseFile()
    expect(screen.getByText(file.name)).toBeInTheDocument()
    expect(screen.queryByLabelText("简历内容")).not.toBeInTheDocument()
    chooseText()
    expect(screen.getByLabelText("简历内容")).toHaveValue("项目经历\n负责订单系统重构")
    fireEvent.click(screen.getByRole("button", { name: "导入并打开" }))
    await waitFor(() => expect(importOldResume).toHaveBeenCalledWith({
      title: "未命名简历", raw_text: "项目经历\n负责订单系统重构",
    }, expect.any(Function)))
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/workspaces/doc_import"))
  })

  it("imports a file using its name without the extension", async () => {
    const { onCreated } = setup()
    chooseImport()
    const file = upload(new File(["resume"], "我的简历.final.PDF", { type: "application/pdf" }))
    fireEvent.click(screen.getByRole("button", { name: "导入并打开" }))
    await waitFor(() => expect(importOldResume).toHaveBeenCalledWith({ title: "我的简历.final", file }, expect.any(Function)))
    expect(onCreated).toHaveBeenCalledOnce()
  })

  it("preserves a manually entered name when replacing or removing a file", () => {
    setup()
    chooseImport()
    fireEvent.change(screen.getByLabelText("简历名称"), { target: { value: "我的投递版本" } })
    upload()
    upload(new File(["other"], "other.txt"))
    expect(screen.getByLabelText("简历名称")).toHaveValue("我的投递版本")
    fireEvent.click(screen.getByRole("button", { name: "移除文件" }))
    expect(screen.getByLabelText("简历名称")).toHaveValue("我的投递版本")
    expect(screen.getByRole("button", { name: "导入并打开" })).toBeDisabled()
  })

  it("accepts a dropped file and rejects unsupported or empty files", () => {
    setup()
    chooseImport()
    upload(new File(["image"], "resume.png"))
    expect(screen.getByRole("alert")).toHaveTextContent("支持 PDF、Word、Markdown 或 TXT 文件。")
    expect(screen.getByRole("button", { name: "导入并打开" })).toBeDisabled()
    upload(new File([], "empty.pdf"))
    expect(screen.getByRole("alert")).toHaveTextContent("文件内容为空")
    const file = new File(["resume"], "dropped.docx")
    fireEvent.drop(screen.getByTestId("resume-file-dropzone"), { dataTransfer: { files: [file] } })
    expect(screen.getByText("dropped.docx")).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "导入并打开" })).toBeEnabled()
  })

  it("retains all inputs after failure and allows a retry", async () => {
    vi.mocked(importOldResume).mockRejectedValueOnce(new Error("offline"))
    setup()
    chooseImport()
    chooseText()
    fireEvent.change(screen.getByLabelText("简历名称"), { target: { value: "重试草稿" } })
    fireEvent.change(screen.getByLabelText("简历内容"), { target: { value: "保留这段经历" } })
    fireEvent.click(screen.getByRole("button", { name: "导入并打开" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("导入失败")
    expect(screen.getByLabelText("简历名称")).toHaveValue("重试草稿")
    expect(screen.getByLabelText("简历内容")).toHaveValue("保留这段经历")
    fireEvent.click(screen.getByRole("button", { name: "导入并打开" }))
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/workspaces/doc_import"))
    expect(importOldResume).toHaveBeenCalledTimes(2)
  })

  it("blocks duplicate submits, mode changes and dismissal while showing real import progress", async () => {
    let finish!: (value: unknown) => void
    vi.mocked(importOldResume).mockImplementation((_input, onProgress) => new Promise((resolve) => {
      finish = resolve as typeof finish
      onProgress?.("save_source")
    }))
    const { onClose } = setup()
    chooseImport()
    upload()
    fireEvent.submit(screen.getByRole("button", { name: "导入并打开" }).closest("form")!)
    fireEvent.submit(screen.getByRole("button", { name: "导入并打开" }).closest("form")!)
    expect(importOldResume).toHaveBeenCalledOnce()
    expect(screen.getByRole("status")).toHaveTextContent("正在提取内容并准备画布")
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled()
    expect(screen.getByRole("radio", { name: "空白简历" })).toBeDisabled()
    expect(screen.getByRole("tab", { name: "粘贴文本" })).toBeDisabled()
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => { finish({ document: { id: "doc_import" } }) })
    expect(onClose).toHaveBeenCalledOnce()
  })
})
