import { Component, type ReactNode } from "react"
import { act, render, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
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
