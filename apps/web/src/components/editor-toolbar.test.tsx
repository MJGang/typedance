import "@testing-library/jest-dom/vitest"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { Bold, Eraser } from "lucide-react"
import { beforeAll, describe, expect, it, vi } from "vitest"

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { EditorToolbar, FontSizeToolbarButton, ToolbarIconButton } from "./editor-toolbar"

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  globalThis.ResizeObserver = ResizeObserverMock
})

describe("EditorToolbar", () => {
  it.each(["12", "invalid"])("keeps native Enter activation on the reset button with draft %s", (draft) => {
    const onChange = vi.fn()
    render(<EditorToolbar><FontSizeToolbarButton value="16px" onChange={onChange} /></EditorToolbar>)
    fireEvent.click(screen.getByRole("button", { name: "字号" }))
    fireEvent.change(screen.getByRole("textbox", { name: "字号数值" }), { target: { value: draft } })
    const reset = screen.getByRole("button", { name: "恢复模板" })
    reset.focus()
    expect(fireEvent.keyDown(reset, { key: "Enter", cancelable: true })).toBe(true)
    expect(onChange).not.toHaveBeenCalled()
    // jsdom 不执行原生按钮默认动作；只有未取消的 keydown 才能在浏览器中生成此 click。
    fireEvent.click(reset)
    expect(onChange).toHaveBeenCalledExactlyOnceWith(null)
  })

  it("exposes pressed state only for controlled toolbar toggles", () => {
    render(
      <TooltipProvider>
        <EditorToolbar>
          <ToolbarIconButton label="加粗" icon={Bold} isActive onClick={() => {}} />
          <ToolbarIconButton label="清除样式" icon={Eraser} onClick={() => {}} />
        </EditorToolbar>
      </TooltipProvider>,
    )

    expect(screen.getByRole("button", { name: "加粗" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "清除样式" })).not.toHaveAttribute("aria-pressed")
  })

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
