import "@testing-library/jest-dom/vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter, useLocation } from "react-router-dom"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { deleteRevisionDocument, duplicateRevisionDocument, listRevisionDocuments, updateRevisionDocument } from "@/api"
import { flushSourceCanvasSaves } from "../revision/useSourceCanvasAutosave"
import { pageMarginStorageKey } from "../revision/pageMargins"
import { ResumePackNavigationProvider } from "./ResumePackNavigation"
import { ResumeDocumentList } from "./ResumeDocumentList"

vi.mock("@/api", () => ({ listRevisionDocuments: vi.fn(), duplicateRevisionDocument: vi.fn(), updateRevisionDocument: vi.fn(), deleteRevisionDocument: vi.fn() }))
vi.mock("../revision/useSourceCanvasAutosave", () => ({ flushSourceCanvasSaves: vi.fn(async () => true) }))
vi.mock("./CreateResumeDialog", () => ({ CreateResumeDialog: () => null }))

const resume = { id: "doc-one", title: "原始简历", pack_id: "resume", template_id: "classic-a4" }
function Probe() { return <p data-testid="location">{useLocation().pathname}</p> }
function setup() {
  const onDocumentRenamed = vi.fn()
  render(<MemoryRouter initialEntries={["/packs/resume/workspaces/doc-one"]}><ResumePackNavigationProvider><Probe /><ResumeDocumentList activeDocument={resume} onDocumentRenamed={onDocumentRenamed} /></ResumePackNavigationProvider></MemoryRouter>)
  return { onDocumentRenamed }
}
async function openMenu() {
  const trigger = await screen.findByRole("button", { name: "管理简历 原始简历" })
  fireEvent.keyDown(trigger, { key: "ArrowDown" })
  return screen.findByRole("menu")
}
describe("ResumeDocumentList actions", () => {
  beforeAll(() => { Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() }) })
  beforeEach(() => { vi.mocked(listRevisionDocuments).mockResolvedValue([resume] as never) })
  afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear() })

  it("flushes the canvas before making a copy and opens the independent copy", async () => {
    setup()
    const copy = { ...resume, id: "doc-copy", title: "原始简历 副本" }
    const margins = JSON.stringify({ top: 40, bottom: 42, left: 30, right: 35 })
    localStorage.setItem(pageMarginStorageKey(resume.id), margins)
    vi.mocked(duplicateRevisionDocument).mockResolvedValueOnce(copy as never)
    let finishFlush!: (saved: boolean) => void
    vi.mocked(flushSourceCanvasSaves).mockImplementationOnce(() => new Promise((resolve) => { finishFlush = resolve }))
    fireEvent.click(within(await openMenu()).getByRole("menuitem", { name: "复制" }))
    expect(flushSourceCanvasSaves).toHaveBeenCalledWith("doc-one")
    expect(duplicateRevisionDocument).not.toHaveBeenCalled()
    await act(async () => { finishFlush(true) })
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/workspaces/doc-copy"))
    expect(duplicateRevisionDocument).toHaveBeenCalledWith("doc-one")
    expect(localStorage.getItem(pageMarginStorageKey(copy.id))).toBeNull()
    expect(localStorage.getItem(pageMarginStorageKey(resume.id))).toBe(margins)
  })

  it("keeps the original when its latest edits cannot be saved", async () => {
    setup()
    vi.mocked(flushSourceCanvasSaves).mockResolvedValueOnce(false)
    fireEvent.click(within(await openMenu()).getByRole("menuitem", { name: "复制" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("尚未保存")
    expect(duplicateRevisionDocument).not.toHaveBeenCalled()
    expect(screen.getByTestId("location")).toHaveTextContent("/workspaces/doc-one")
  })

  it("renames a resume and notifies the open editor", async () => {
    const { onDocumentRenamed } = setup()
    vi.mocked(updateRevisionDocument).mockResolvedValueOnce({ ...resume, title: "面试简历" } as never)
    fireEvent.click(within(await openMenu()).getByRole("menuitem", { name: "重命名" }))
    const dialog = screen.getByRole("dialog", { name: "重命名简历" })
    fireEvent.change(within(dialog).getByLabelText("简历名称"), { target: { value: "面试简历" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "保存名称" }))
    await waitFor(() => expect(onDocumentRenamed).toHaveBeenCalledWith(expect.objectContaining({ id: "doc-one", title: "面试简历" })))
    expect(updateRevisionDocument).toHaveBeenCalledWith("doc-one", { title: "面试简历" })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("confirms deletion, retains the dialog after failure, and leaves the deleted editor after retry", async () => {
    setup()
    vi.mocked(deleteRevisionDocument).mockRejectedValueOnce(new Error("failed")).mockResolvedValueOnce(undefined)
    fireEvent.click(within(await openMenu()).getByRole("menuitem", { name: "删除" }))
    const dialog = screen.getByRole("dialog", { name: "删除简历「原始简历」？" })
    expect(deleteRevisionDocument).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole("button", { name: "删除简历" }))
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("删除失败")
    vi.mocked(listRevisionDocuments).mockResolvedValue([])
    fireEvent.click(within(dialog).getByRole("button", { name: "删除简历" }))
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/packs/resume/workspaces"))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })
})
