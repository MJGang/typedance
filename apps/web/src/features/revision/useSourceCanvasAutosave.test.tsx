import { Component, type ReactNode } from "react"
import { render, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import {
  __hasSourceCanvasAutosaveCoordinatorForTests,
  useSourceCanvasAutosave,
} from "./useSourceCanvasAutosave"

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
