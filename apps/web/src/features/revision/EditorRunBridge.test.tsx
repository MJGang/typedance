import "@testing-library/jest-dom/vitest"
import { useEffect, useState } from "react"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { EditorRequest, EditorSnapshot } from "@typedance/contracts"
import { createAgentRunEventSource, getConversationActiveRun, getEditorRequest, listAgentRunEvents, respondToEditorRequest } from "@/agentHost"
import { EditorRunBridge } from "./EditorRunBridge"
import { EditorReferencesProvider, useEditorReferences, type CanvasReferenceBridge } from "./references/EditorReferences"

vi.mock("@/agentHost", () => ({ createAgentRunEventSource: vi.fn(), getConversationActiveRun: vi.fn(), getEditorRequest: vi.fn(), listAgentRunEvents: vi.fn(), respondToEditorRequest: vi.fn() }))
vi.mock("./useSourceCanvasAutosave", () => ({ flushSourceCanvasSaves: async () => true }))
const snapshot: EditorSnapshot = { document_id: "doc", editor_session_id: "new", content_revision: 0, canvas_version: 1,
  doc_json: { type: "doc", content: [] }, plain_text: "current canvas" }
const read: EditorRequest = { id: "read", document_id: "doc", editor_session_id: "old", kind: "snapshot", mode: "review" }
const onCompleted = vi.fn()

function Canvas({ bridge }: { bridge: CanvasReferenceBridge }) {
  const register = useEditorReferences()!.registerCanvas
  useEffect(() => register(bridge), [register, bridge])
  return null
}
function Workspace({ bridge, revision = 0 }: { bridge: CanvasReferenceBridge; revision?: number }) {
  const [selected, setSelected] = useState("running chat")
  return <EditorReferencesProvider documentId="doc">
    <Canvas bridge={bridge} /><EditorRunBridge conversationId="conv" revision={revision} onCompleted={onCompleted} />
    <button onClick={() => setSelected("new chat")}>新对话</button><p>{selected}</p>
  </EditorReferencesProvider>
}
function setup() {
  const source = Object.assign(new EventTarget(), { close: vi.fn() })
  vi.mocked(createAgentRunEventSource).mockReturnValue(source as unknown as ReturnType<typeof createAgentRunEventSource>)
  const bridge: CanvasReferenceBridge = { getSnapshot: vi.fn(async () => snapshot), getRevision: () => 0, apply: vi.fn(() => true), undo: () => true,
    track: vi.fn(), untrack: vi.fn(), setOrdinals: vi.fn(), locate: () => false }
  const view = render(<Workspace bridge={bridge} />)
  const dispatch = (request: EditorRequest) => act(() => source.dispatchEvent(new MessageEvent("editor_request", { data: JSON.stringify({
    id: request.id, run_id: "run", sequence: 1, type: "editor_request", payload: { request }, created_at: "2026-10-25T00:00:00Z",
  }) })))
  return { ...view, source, bridge, dispatch }
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getConversationActiveRun).mockResolvedValue({ id: "run", conversation_id: "conv", status: "running" } as Awaited<ReturnType<typeof getConversationActiveRun>>)
  vi.mocked(listAgentRunEvents).mockResolvedValue([])
  vi.mocked(getEditorRequest).mockResolvedValue(read)
  vi.mocked(respondToEditorRequest).mockResolvedValue(undefined)
})
afterEach(cleanup)

describe("workspace editor execution", () => {
  it("continues reading after switching to a new chat, reconnects the live canvas, and ignores duplicate events", async () => {
    const { source, bridge, dispatch, unmount } = setup()
    await waitFor(() => expect(createAgentRunEventSource).toHaveBeenCalledWith("run", -1))
    fireEvent.click(screen.getByRole("button", { name: "新对话" }))
    expect(screen.getByText("new chat")).toBeInTheDocument()
    dispatch(read)
    await waitFor(() => expect(respondToEditorRequest).toHaveBeenCalledWith("run", "read", { status: "snapshot", snapshot }))
    dispatch(read)
    expect(bridge.getSnapshot).toHaveBeenCalledOnce()
    expect(source.close).not.toHaveBeenCalled()
    unmount()
    expect(source.close).toHaveBeenCalledOnce()
  })

  it("executes only live automatic writes and leaves review transactions for explicit approval", async () => {
    const { bridge, dispatch } = setup()
    await waitFor(() => expect(createAgentRunEventSource).toHaveBeenCalled())
    const transaction: EditorRequest = { ...read, id: "write", kind: "transaction", mode: "solo", editor_session_id: "new", transaction: {
      id: "tx", document_id: "doc", editor_session_id: "new", content_revision: 0, before_doc_json: snapshot.doc_json, doc_json: snapshot.doc_json,
      catalog_revision: "current", summary: "test", effects: [], node_origins: [], text_origins: [],
    } }
    vi.mocked(getEditorRequest).mockResolvedValue(transaction)
    fireEvent.click(screen.getByRole("button", { name: "新对话" }))
    dispatch(transaction)
    await waitFor(() => expect(respondToEditorRequest).toHaveBeenCalledWith("run", "write", expect.objectContaining({ status: "applied", persisted: true })))
    dispatch({ ...transaction, id: "manual", mode: "review" })
    vi.mocked(getEditorRequest).mockRejectedValue(new Error("request ended"))
    dispatch({ ...transaction, id: "cancelled" })
    await act(async () => {})
    expect(bridge.apply).toHaveBeenCalledOnce()
  })
  it("retries a lost acknowledgement without taking a second snapshot", async () => {
    vi.mocked(respondToEditorRequest).mockRejectedValueOnce(new Error("temporary network failure"))
    const { bridge, dispatch } = setup()
    await waitFor(() => expect(createAgentRunEventSource).toHaveBeenCalled())
    dispatch(read)
    await waitFor(() => expect(respondToEditorRequest).toHaveBeenCalledTimes(2), { timeout: 2500 })
    expect(bridge.getSnapshot).toHaveBeenCalledOnce()
  })
  it.each(["active run", "history"])("retries an initial %s request after a transient network failure", async (stage) => {
    if (stage === "active run") vi.mocked(getConversationActiveRun).mockRejectedValueOnce(new Error("network failure"))
    else vi.mocked(listAgentRunEvents).mockRejectedValueOnce(new Error("network failure"))
    const { dispatch } = setup()
    await waitFor(() => expect(createAgentRunEventSource).toHaveBeenCalledWith("run", -1), { timeout: 3500 })
    dispatch(read)
    await waitFor(() => expect(respondToEditorRequest).toHaveBeenCalledWith("run", "read", { status: "snapshot", snapshot }))
  })
  it("rebinds a new run when the same conversation stays running across list refreshes", async () => {
    const { source, bridge, rerender } = setup()
    await waitFor(() => expect(createAgentRunEventSource).toHaveBeenCalledWith("run", -1))
    const nextSource = Object.assign(new EventTarget(), { close: vi.fn() })
    vi.mocked(getConversationActiveRun).mockResolvedValue({ id: "next-run", conversation_id: "conv", status: "running" } as Awaited<ReturnType<typeof getConversationActiveRun>>)
    vi.mocked(createAgentRunEventSource).mockReturnValue(nextSource as unknown as ReturnType<typeof createAgentRunEventSource>)
    rerender(<Workspace bridge={bridge} revision={1} />)
    await waitFor(() => expect(createAgentRunEventSource).toHaveBeenCalledWith("next-run", -1))
    expect(source.close).toHaveBeenCalledOnce()
    const nextRead = { ...read, id: "next-read" }
    vi.mocked(getEditorRequest).mockResolvedValue(nextRead)
    act(() => nextSource.dispatchEvent(new MessageEvent("editor_request", { data: JSON.stringify({ id: "next-read", run_id: "next-run", sequence: 1, type: "editor_request", payload: { request: nextRead }, created_at: "2026-10-25T00:00:00Z" }) })))
    await waitFor(() => expect(respondToEditorRequest).toHaveBeenCalledWith("next-run", "next-read", { status: "snapshot", snapshot }))
  })
})
