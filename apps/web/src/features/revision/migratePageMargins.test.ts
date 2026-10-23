import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SourceResumeCanvas } from "@typedance/contracts"
import { getRevisionWorkspaceView, migrateEditorPageMargins } from "@/api"
import { migrateDocumentPageMargins, migratePageMargins } from "./migratePageMargins"

vi.mock("@/api", () => ({ migrateEditorPageMargins: vi.fn(), getRevisionWorkspaceView: vi.fn() }))
const source = { document_id: "doc", doc_json: { type: "doc", content: [{ type: "paragraph" }] } } as unknown as SourceResumeCanvas
const key = "typedance:revision-workspace:page-margins:doc"
const margins = { top: 40, bottom: 40, left: 32, right: 32 }
beforeEach(() => { localStorage.clear(); vi.resetAllMocks() })

describe("one-time page layout migration", () => {
  it("moves the old value to backend and deletes the old key only after persistence succeeds", async () => {
    const raw = JSON.stringify(margins)
    localStorage.setItem(key, raw)
    const saved = { ...source, doc_json: { ...source.doc_json, attrs: { pageMargins: margins } } }
    vi.mocked(migrateEditorPageMargins).mockResolvedValue(saved)
    expect(await migratePageMargins(source)).toEqual(saved)
    expect(migrateEditorPageMargins).toHaveBeenCalledWith("doc", margins, raw)
    expect(localStorage.getItem(key)).toBeNull()
    await migratePageMargins(saved)
    expect(migrateEditorPageMargins).toHaveBeenCalledOnce()
  })

  it("retains the original local value if backend backup or persistence fails", async () => {
    const raw = JSON.stringify(margins)
    localStorage.setItem(key, raw)
    vi.mocked(migrateEditorPageMargins).mockRejectedValue(new Error("保存失败"))
    await expect(migratePageMargins(source)).rejects.toThrow("保存失败")
    expect(localStorage.getItem(key)).toBe(raw)
  })

  it("backs up malformed old preferences without preventing the existing canvas from opening", async () => {
    localStorage.setItem(key, "malformed")
    vi.mocked(migrateEditorPageMargins).mockResolvedValue(source)
    expect(await migratePageMargins(source)).toEqual(source)
    expect(migrateEditorPageMargins).toHaveBeenCalledWith("doc", null, "malformed")
    expect(localStorage.getItem(key)).toBeNull()
  })

  it("migrates an unopened source document before backend duplication", async () => {
    const raw = JSON.stringify(margins)
    localStorage.setItem(key, raw)
    vi.mocked(getRevisionWorkspaceView).mockResolvedValue({ source_resume_canvas: source } as never)
    vi.mocked(migrateEditorPageMargins).mockResolvedValue({ ...source, doc_json: { ...source.doc_json, attrs: { pageMargins: margins } } })
    await migrateDocumentPageMargins("doc")
    expect(getRevisionWorkspaceView).toHaveBeenCalledWith("doc")
    expect(migrateEditorPageMargins).toHaveBeenCalledWith("doc", margins, raw)
    expect(localStorage.getItem(key)).toBeNull()
    await migrateDocumentPageMargins("doc")
    expect(getRevisionWorkspaceView).toHaveBeenCalledOnce()
  })
})
