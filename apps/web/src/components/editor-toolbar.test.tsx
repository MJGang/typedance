import "@testing-library/jest-dom/vitest"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeAll, describe, expect, it, vi } from "vitest"

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { EditorToolbar } from "./editor-toolbar"

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  globalThis.ResizeObserver = ResizeObserverMock
})

describe("EditorToolbar", () => {
  it("delays toolbar tooltips without inheriting the instant site default", async () => {
    vi.useFakeTimers()
    const view = render(
      <TooltipProvider delayDuration={0}>
        <EditorToolbar>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button">加粗</button>
            </TooltipTrigger>
            <TooltipContent>加粗</TooltipContent>
          </Tooltip>
        </EditorToolbar>
      </TooltipProvider>,
    )

    try {
      fireEvent.pointerMove(screen.getByRole("button", { name: "加粗" }), { pointerType: "mouse" })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(499)
      })
      expect(document.querySelector('[data-slot="tooltip-content"]')).not.toBeInTheDocument()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
      })
      expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveTextContent("加粗")
    } finally {
      view.unmount()
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })
})
