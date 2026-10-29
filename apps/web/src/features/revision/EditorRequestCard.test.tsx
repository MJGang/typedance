import "@testing-library/jest-dom/vitest"
import { useEffect } from "react"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AgentRunEvent, EditorRequest, EditorSnapshot } from "@typedance/contracts"
import { beginEditorRequest, getEditorRequest, respondToEditorRequest } from "@/agentHost"
import { EditorRequestCard } from "./EditorRequestCard"
import { flushSourceCanvasSaves } from "./useSourceCanvasAutosave"
import { EditorReferencesProvider, useEditorReferences, type CanvasReferenceBridge } from "./references/EditorReferences"
import { installTestAccountSession } from "@/test/accountFixture"
import { setAccountSaveOnly } from "@/accountSession"

beforeEach(() => installTestAccountSession())

vi.mock("@/agentHost", () => ({ beginEditorRequest: vi.fn(), getEditorRequest: vi.fn(), respondToEditorRequest: vi.fn() }))
vi.mock("./useSourceCanvasAutosave", () => ({ flushSourceCanvasSaves: vi.fn() }))
vi.mock("./EditorTransactionPreview", () => ({ default: () => <div>真实文档预览入口</div> }))

const snapshot: EditorSnapshot = { document_id: "doc", editor_session_id: "session", content_revision: 3, canvas_version: 1,
  doc_json: { type: "doc", content: [{ type: "paragraph" }] }, plain_text: "" }
const request: EditorRequest = { id: "request", document_id: "doc", editor_session_id: "session", kind: "transaction", mode: "review", transaction: {
  id: "transaction", document_id: "doc", editor_session_id: "session", content_revision: 2, before_doc_json: snapshot.doc_json, doc_json: snapshot.doc_json,
  catalog_revision: "current", summary: "教育经历改为四栏，最后一栏右对齐", effects: [{ capability: "columns.layout", title: "分栏排版", effect: "layout" }], node_origins: [], text_origins: [],
} }
function Bridge({ bridge }: { bridge: CanvasReferenceBridge }) {
  const register = useEditorReferences()!.registerCanvas
  useEffect(() => register(bridge), [register, bridge])
  return <button onClick={() => register({ ...bridge, undo: () => true })}>切换编辑会话</button>
}
function setup(value = request, active = true, changed = true) {
  vi.mocked(flushSourceCanvasSaves).mockResolvedValue(true)
  const bridge: CanvasReferenceBridge = { getSnapshot: vi.fn(async () => snapshot), getRevision: () => 3,
    apply: vi.fn(() => changed), undo: vi.fn(() => true), track: vi.fn(), untrack: vi.fn(), setOrdinals: vi.fn(), locate: () => false }
  vi.mocked(getEditorRequest).mockResolvedValue(value)
  vi.mocked(beginEditorRequest).mockResolvedValue(value)
  vi.mocked(respondToEditorRequest).mockResolvedValue(undefined)
  const content = (key: string, events: AgentRunEvent[]) => <EditorReferencesProvider documentId="doc"><Bridge bridge={bridge} /><EditorRequestCard key={key} runId="run" request={value} events={events} active={active} /></EditorReferencesProvider>
  const view = render(content("initial", []))
  return { bridge, remount: (events: AgentRunEvent[]) => view.rerender(content("restored", events)) }
}
afterEach(() => { cleanup(); vi.resetAllMocks() })

describe("editor request decisions", () => {
  it("never applies an approval response from before a pause even after activities resume", async () => {
    const { bridge } = setup()
    let finishApproval!: (value: EditorRequest) => void
    vi.mocked(beginEditorRequest).mockImplementation(() => new Promise((resolve) => { finishApproval = resolve }))
    fireEvent.click(screen.getByRole("button", { name: "应用修改" }))
    await waitFor(() => expect(beginEditorRequest).toHaveBeenCalled())
    act(() => { setAccountSaveOnly(true); setAccountSaveOnly(false) })
    await act(async () => { finishApproval(request) })
    expect(await screen.findByRole("alert")).toHaveTextContent("账号活动已暂停")
    expect(bridge.apply).not.toHaveBeenCalled()
    expect(respondToEditorRequest).not.toHaveBeenCalled()
  })

  it("does not undo another editor session even if its content revision has the same value", async () => {
    setup()
    fireEvent.click(screen.getByRole("button", { name: "应用修改" }))
    await screen.findByText("已应用")
    fireEvent.click(screen.getByRole("button", { name: "切换编辑会话" }))
    fireEvent.click(screen.getByRole("button", { name: "撤销修改" }))
    expect(screen.getByText("已应用")).toBeInTheDocument()
    expect(screen.queryByText("已撤销")).not.toBeInTheDocument()
  })

  it("reports unchanged operations without registering or exposing undo for earlier user edits", async () => {
    const { bridge } = setup(request, true, false)
    fireEvent.click(screen.getByRole("button", { name: "应用修改" }))
    await screen.findByText("已符合要求")
    expect(respondToEditorRequest).toHaveBeenCalledWith("run", "request", { status: "unchanged", snapshot })
    expect(screen.queryByRole("button", { name: "撤销修改" })).not.toBeInTheDocument()
    expect(flushSourceCanvasSaves).not.toHaveBeenCalled()
    expect(bridge.undo).not.toHaveBeenCalled()
  })

  it("review waits for approval and applies one undoable transaction", async () => {
    const { bridge } = setup()
    expect(bridge.apply).not.toHaveBeenCalled()
    expect(screen.getByText("等待你应用修改")).toBeInTheDocument()
    expect(beginEditorRequest).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "应用修改" }))
    await screen.findByText("已应用")
    expect(bridge.apply).toHaveBeenCalledExactlyOnceWith(request.transaction)
    expect(beginEditorRequest).toHaveBeenCalledExactlyOnceWith("run", "request")
    expect(respondToEditorRequest).toHaveBeenCalledWith("run", "request", { status: "applied", snapshot, persisted: true })
    fireEvent.click(screen.getByRole("button", { name: "撤销修改" }))
    expect(bridge.undo).toHaveBeenCalledOnce()
    expect(screen.getByText("已撤销")).toBeInTheDocument()
  })

  it("does not edit if the Host refuses to begin an ended request", async () => {
    const { bridge } = setup()
    vi.mocked(beginEditorRequest).mockRejectedValueOnce(new Error("编辑请求已结束"))
    fireEvent.click(screen.getByRole("button", { name: "应用修改" }))
    await screen.findByText("编辑请求已结束")
    expect(bridge.apply).not.toHaveBeenCalled()
    expect(respondToEditorRequest).not.toHaveBeenCalled()
  })

  it("does not start execution for a rejection", async () => {
    const { bridge } = setup()
    fireEvent.click(screen.getByRole("button", { name: "保留原文" }))
    await waitFor(() => expect(respondToEditorRequest).toHaveBeenCalledWith("run", "request", { status: "rejected" }))
    expect(beginEditorRequest).not.toHaveBeenCalled()
    expect(bridge.apply).not.toHaveBeenCalled()
  })

  it("retries only the acknowledgement after a transport failure", async () => {
    const { bridge } = setup()
    vi.mocked(respondToEditorRequest).mockRejectedValueOnce(new Error("网络中断"))
    fireEvent.click(screen.getByRole("button", { name: "应用修改" }))
    await screen.findByText("网络中断")
    fireEvent.click(screen.getByRole("button", { name: "重试回传结果" }))
    await screen.findByText("已应用")
    expect(bridge.apply).toHaveBeenCalledOnce()
    expect(beginEditorRequest).toHaveBeenCalledOnce()
    expect(respondToEditorRequest).toHaveBeenCalledTimes(2)
  })

  it("reports successful writing even when the subsequent page observation fails", async () => {
    const { bridge } = setup()
    vi.mocked(bridge.getSnapshot).mockResolvedValueOnce(snapshot).mockRejectedValueOnce(new Error("截图失败"))
    fireEvent.click(screen.getByRole("button", { name: "应用修改" }))
    await screen.findByText("已应用")
    expect(bridge.apply).toHaveBeenCalledOnce()
    expect(respondToEditorRequest).toHaveBeenCalledWith("run", "request", { status: "applied", snapshot, persisted: true, error: expect.stringContaining("截图失败") })
  })

  it("recovers a lost acknowledgement after the card remounts without editing the canvas again", async () => {
    const { bridge, remount } = setup()
    vi.mocked(respondToEditorRequest).mockRejectedValueOnce(new Error("网络中断"))
    fireEvent.click(screen.getByRole("button", { name: "应用修改" }))
    await screen.findByText("网络中断")
    remount([{ id: "started", run_id: "run", sequence: 1, type: "editor_execution_started", created_at: "2026-10-27T07:00:00.000Z", payload: { request_id: "request" } }])
    expect(screen.queryByText("网络中断")).not.toBeInTheDocument()
    expect(screen.getByText("正在应用")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "重试回传结果" }))
    await screen.findByText("已应用")
    expect(bridge.apply).toHaveBeenCalledOnce()
    expect(flushSourceCanvasSaves).toHaveBeenCalledOnce()
    expect(beginEditorRequest).toHaveBeenCalledTimes(2)
    expect(respondToEditorRequest).toHaveBeenCalledTimes(2)
    expect(respondToEditorRequest).toHaveBeenLastCalledWith("run", "request", { status: "applied", snapshot, persisted: true })
  })

  it("does not report persistence or repeat editing after backend saving fails", async () => {
    const { bridge } = setup()
    vi.mocked(flushSourceCanvasSaves).mockResolvedValue(false)
    fireEvent.click(screen.getByRole("button", { name: "应用修改" }))
    await waitFor(() => expect(respondToEditorRequest).toHaveBeenCalledWith("run", "request", { status: "applied", snapshot, persisted: false, error: expect.stringContaining("后端保存失败") }))
    expect(bridge.apply).toHaveBeenCalledOnce()
  })

  it("rejects without writing and never executes historical solo requests", async () => {
    const { bridge } = setup()
    fireEvent.click(screen.getByRole("button", { name: "保留原文" }))
    await screen.findByText("保留原文")
    await waitFor(() => expect(respondToEditorRequest).toHaveBeenCalledWith("run", "request", { status: "rejected" }))
    expect(bridge.apply).not.toHaveBeenCalled()
    cleanup()
    const { bridge: historical } = setup({ ...request, mode: "solo" }, false)
    expect(historical.apply).not.toHaveBeenCalled()
    expect(screen.queryByRole("button", { name: "应用修改" })).not.toBeInTheDocument()
  })

  it("leaves automatic execution to the document bridge instead of the selected chat", async () => {
    const { bridge } = setup({ ...request, mode: "solo" })
    await screen.findByText("正在应用")
    expect(bridge.apply).not.toHaveBeenCalled()
    expect(getEditorRequest).not.toHaveBeenCalled()
  })
})
