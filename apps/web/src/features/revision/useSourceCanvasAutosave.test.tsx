import { Component, type ReactNode } from "react"
import { act, render, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { SourceResumeCanvas } from "@typedance/contracts"
import { saveSourceResumeCanvas } from "@/api"
import {
  __hasSourceCanvasAutosaveCoordinatorForTests,
  useSourceCanvasAutosave,
} from "./useSourceCanvasAutosave"

vi.mock("@/api", () => ({ saveSourceResumeCanvas: vi.fn() }))

class RenderErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {}

  render() {
    return this.state.failed ? null : this.props.children
  }
}

function AbandonedAutosaveHook(): ReactNode {
  useSourceCanvasAutosave("doc_abandoned_render", () => {})
  throw new Error("abandon autosave hook render")
}

describe("useSourceCanvasAutosave", () => {
  it("keeps the save failure reason available to the canvas", async () => {
    vi.mocked(saveSourceResumeCanvas).mockRejectedValueOnce(new Error("Duplicate canvasNodeId: node_1"))
    const { result } = renderHook(() => useSourceCanvasAutosave("doc_save_error_reason", () => {}))

    act(() => result.current.handleChange({ plainText: "", docJson: { type: "doc", content: [] } }))
    await waitFor(() => expect(result.current.saveStatus).toBe("error"), { timeout: 2000 })
    expect(result.current.saveError).toBe("Duplicate canvasNodeId: node_1")
  })

  it("repairs a duplicate identity in a failed pending save before retrying", async () => {
    vi.mocked(saveSourceResumeCanvas)
      .mockRejectedValueOnce(new Error("Duplicate canvasNodeId: node_work"))
      .mockResolvedValueOnce({} as SourceResumeCanvas)
    const { result } = renderHook(() => useSourceCanvasAutosave("doc_duplicate_retry", () => {}))
    const docJson = {
      type: "doc" as const,
      content: [
        { type: "heading", attrs: { canvasNodeId: "node_work", sourceBlockId: "block_work" }, content: [{ type: "text", text: "公司" }] },
        { type: "heading", attrs: { canvasNodeId: "node_work", sourceBlockId: "block_work" }, content: [{ type: "text", text: "职位" }] },
      ],
    }

    act(() => result.current.handleChange({ plainText: "", docJson }))
    await act(async () => { await result.current.flush() })
    expect(result.current.saveStatus).toBe("error")

    act(() => result.current.retry())
    await waitFor(() => expect(result.current.saveStatus).toBe("saved"))
    const calls = vi.mocked(saveSourceResumeCanvas).mock.calls
    expect(calls[calls.length - 1]?.[1]).toMatchObject({
      content: [
        { attrs: { canvasNodeId: "node_work", sourceBlockId: "block_work" } },
        { attrs: { canvasNodeId: null, sourceBlockId: null } },
      ],
    })
  })

  it("prunes an empty coordinator created by an abandoned render", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    try {
      render(
        <RenderErrorBoundary>
          <AbandonedAutosaveHook />
        </RenderErrorBoundary>,
      )

      expect(__hasSourceCanvasAutosaveCoordinatorForTests("doc_abandoned_render")).toBe(true)
      await waitFor(() => {
        expect(__hasSourceCanvasAutosaveCoordinatorForTests("doc_abandoned_render")).toBe(false)
      })
    } finally {
      consoleError.mockRestore()
    }
  })
})
