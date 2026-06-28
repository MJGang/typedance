import "@testing-library/jest-dom/vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { PanelResizeHandle } from "./PanelResizeHandle"

const OriginalPointerEvent = globalThis.PointerEvent

class PointerEventMock extends MouseEvent {
  pointerId: number

  constructor(type: string, properties: PointerEventInit = {}) {
    super(type, properties)
    this.pointerId = properties.pointerId ?? 0
  }
}

beforeAll(() => {
  globalThis.PointerEvent = PointerEventMock as typeof PointerEvent
})

afterAll(() => {
  globalThis.PointerEvent = OriginalPointerEvent
})

describe("PanelResizeHandle", () => {
  it("resizes in the configured pointer direction and commits on release", () => {
    const onResize = vi.fn()
    const onResizeEnd = vi.fn()
    render(
      <PanelResizeHandle
        ariaLabel="调整左侧面板宽度"
        direction={1}
        min={220}
        max={420}
        value={272}
        onResize={onResize}
        onResizeEnd={onResizeEnd}
      />,
    )

    const separator = screen.getByRole("separator", { name: "调整左侧面板宽度" })
    fireEvent.pointerDown(separator, { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 180, pointerId: 1 })
    expect(onResize).toHaveBeenLastCalledWith(352)
    expect(onResizeEnd).not.toHaveBeenCalled()

    fireEvent.pointerUp(window, { clientX: 180, pointerId: 1 })
    expect(onResizeEnd).toHaveBeenCalledWith(352)
    expect(document.body.style.userSelect).toBe("")
  })

  it("clamps right-panel dragging and supports keyboard steps", () => {
    const onResize = vi.fn()
    const onResizeEnd = vi.fn()
    render(
      <PanelResizeHandle
        ariaLabel="调整 AI 面板宽度"
        direction={-1}
        min={320}
        max={560}
        value={384}
        onResize={onResize}
        onResizeEnd={onResizeEnd}
      />,
    )

    const separator = screen.getByRole("separator", { name: "调整 AI 面板宽度" })
    fireEvent.pointerDown(separator, { clientX: 500, pointerId: 2 })
    fireEvent.pointerMove(window, { clientX: 200, pointerId: 2 })
    expect(onResize).toHaveBeenLastCalledWith(560)
    fireEvent.pointerCancel(window, { pointerId: 2 })

    fireEvent.keyDown(separator, { key: "ArrowLeft" })
    expect(onResize).toHaveBeenLastCalledWith(400)
    expect(onResizeEnd).toHaveBeenLastCalledWith(400)
    fireEvent.keyDown(separator, { key: "ArrowRight", shiftKey: true })
    expect(onResize).toHaveBeenLastCalledWith(336)
    expect(onResizeEnd).toHaveBeenLastCalledWith(336)
  })
})
