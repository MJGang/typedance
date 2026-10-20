import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getRevisionWorkspaceView, listRevisionDocuments } from "@/api"
import { flushSourceCanvasSaves } from "../revision/useSourceCanvasAutosave"
import { ResumePackNavigationProvider } from "../resume-pack/ResumePackNavigation"
import { useTemplatePreview } from "./useTemplatePreview"

vi.mock("@/api", () => ({ getRevisionWorkspaceView: vi.fn(), listRevisionDocuments: vi.fn() }))
vi.mock("../revision/useSourceCanvasAutosave", () => ({ flushSourceCanvasSaves: vi.fn(async () => true) }))
function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={["/packs/resume/templates/classic-a4"]}><ResumePackNavigationProvider>{children}</ResumePackNavigationProvider></MemoryRouter>
}
const docJson = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "最新内容" }] }] }
describe("template resume preview", () => {
  beforeEach(() => {
    vi.mocked(listRevisionDocuments).mockResolvedValue([{ id: "one", title: "第一份", pack_id: "resume" }, { id: "two", title: "第二份", pack_id: "resume" }] as never)
  })
  afterEach(() => { cleanup(); vi.clearAllMocks() })
  it("waits for pending edits to save before fetching the preview", async () => {
    let saved!: (value: boolean) => void
    vi.mocked(flushSourceCanvasSaves).mockImplementationOnce(() => new Promise((resolve) => { saved = resolve }))
    vi.mocked(getRevisionWorkspaceView).mockResolvedValueOnce({ source_resume_canvas: { doc_json: docJson } } as never)
    const { result } = renderHook(useTemplatePreview, { wrapper })
    await waitFor(() => expect(flushSourceCanvasSaves).toHaveBeenCalledWith("one"))
    expect(getRevisionWorkspaceView).not.toHaveBeenCalled()
    expect(result.current.loading).toBe(true)
    await act(async () => { saved(true) })
    await waitFor(() => expect(result.current.docJson).toEqual(docJson))
  })
  it("exposes an error when edits cannot be saved and retries without showing stale content", async () => {
    vi.mocked(flushSourceCanvasSaves).mockResolvedValueOnce(false)
    const { result } = renderHook(useTemplatePreview, { wrapper })
    await waitFor(() => expect(result.current.error).toBe("简历预览加载失败"))
    expect(getRevisionWorkspaceView).not.toHaveBeenCalled()
    expect(result.current.docJson).toBeUndefined()
    vi.mocked(getRevisionWorkspaceView).mockResolvedValueOnce({ source_resume_canvas: { doc_json: docJson } } as never)
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.docJson).toEqual(docJson))
  })
  it("ignores an older response after the user selects another resume", async () => {
    let finishFirst!: (workspace: never) => void
    vi.mocked(getRevisionWorkspaceView).mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve }))
    vi.mocked(getRevisionWorkspaceView).mockResolvedValueOnce({ source_resume_canvas: { doc_json: docJson } } as never)
    const { result } = renderHook(useTemplatePreview, { wrapper })
    await waitFor(() => expect(getRevisionWorkspaceView).toHaveBeenCalledWith("one"))
    act(() => result.current.setPreviewId("two"))
    await waitFor(() => expect(result.current.docJson).toEqual(docJson))
    await act(async () => { finishFirst({ source_resume_canvas: { doc_json: { type: "doc", content: [] } } } as never) })
    expect(result.current.selectedDocument?.id).toBe("two")
    expect(result.current.docJson).toEqual(docJson)
  })
})
