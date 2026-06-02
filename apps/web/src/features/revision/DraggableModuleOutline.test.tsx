import "@testing-library/jest-dom/vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { ModuleAnchor } from "@typedance/contracts"
import {
  DraggableModuleOutline,
  type DraggableModuleOutlineProps,
} from "./DraggableModuleOutline"

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

const anchors: ModuleAnchor[] = [
  {
    module_id: "module-project",
    canvas_node_ids: ["node-project"],
    title: "项目经历",
    order: 0,
  },
  {
    module_id: "module-education",
    canvas_node_ids: ["node-education"],
    title: "教育经历",
    order: 1,
  },
]

function createProps(
  overrides: Partial<DraggableModuleOutlineProps> = {},
): DraggableModuleOutlineProps {
  return {
    anchors,
    activeModuleId: null,
    expanded: true,
    position: { x: 20, y: 30 },
    bounds: { width: 300, height: 200 },
    saveStatus: "idle",
    onExpandedChange: vi.fn(),
    onPositionCommit: vi.fn(),
    onActivateModule: vi.fn(),
    onScrollToAnchor: vi.fn(),
    ...overrides,
  }
}

function mockOutlineSize(outline: HTMLElement) {
  vi.spyOn(outline, "getBoundingClientRect").mockReturnValue({
    width: 100,
    height: 80,
  } as DOMRect)
}

function mockPointerCapture(handle: HTMLElement) {
  const setPointerCapture = vi.fn()
  const releasePointerCapture = vi.fn()
  const hasPointerCapture = vi.fn(() => true)

  Object.assign(handle, {
    setPointerCapture,
    releasePointerCapture,
    hasPointerCapture,
  })

  return { setPointerCapture, releasePointerCapture }
}

describe("DraggableModuleOutline", () => {
  it("renders expanded items and lets the chevron toggle only expansion", () => {
    const props = createProps()
    const { rerender } = render(<DraggableModuleOutline {...props} />)

    expect(screen.getByRole("button", { name: "项目经历" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "教育经历" })).toBeInTheDocument()

    const toggle = screen.getByRole("button", { name: "折叠模块大纲" })
    fireEvent.pointerDown(toggle, { pointerId: 11, clientX: 40, clientY: 50 })
    fireEvent.pointerMove(toggle, { pointerId: 11, clientX: 200, clientY: 180 })
    fireEvent.pointerUp(toggle, { pointerId: 11, clientX: 200, clientY: 180 })
    fireEvent.click(toggle)

    expect(props.onExpandedChange).toHaveBeenCalledWith(false)
    expect(props.onPositionCommit).not.toHaveBeenCalled()

    rerender(<DraggableModuleOutline {...props} expanded={false} />)

    expect(screen.getByRole("button", { name: "展开模块大纲" })).toHaveAttribute(
      "aria-expanded",
      "false",
    )
    expect(screen.queryByRole("button", { name: "项目经历" })).not.toBeInTheDocument()
  })

  it("marks the active module item", () => {
    render(
      <DraggableModuleOutline
        {...createProps({ activeModuleId: "module-project" })}
      />,
    )

    expect(screen.getByRole("button", { name: "项目经历" })).toHaveAttribute(
      "aria-current",
      "true",
    )
    expect(screen.getByRole("button", { name: "项目经历" })).toHaveAttribute(
      "data-active",
      "true",
    )
    expect(screen.getByRole("button", { name: "项目经历" })).toHaveClass(
      "bg-blue-50",
      "text-blue-700",
    )
    expect(screen.getByRole("button", { name: "教育经历" })).not.toHaveAttribute(
      "aria-current",
    )
  })

  it("activates a module before scrolling to its anchor", () => {
    const calls: string[] = []
    const props = createProps({
      onActivateModule: vi.fn(() => calls.push("activate")),
      onScrollToAnchor: vi.fn(() => calls.push("scroll")),
    })
    render(<DraggableModuleOutline {...props} />)

    fireEvent.click(screen.getByRole("button", { name: "项目经历" }))

    expect(calls).toEqual(["activate", "scroll"])
    expect(props.onActivateModule).toHaveBeenCalledWith("module-project")
    expect(props.onScrollToAnchor).toHaveBeenCalledWith(anchors[0])
  })

  it("announces save status and retries failed saves", () => {
    const onRetrySave = vi.fn()
    const { rerender } = render(
      <DraggableModuleOutline
        {...createProps({ saveStatus: "saving", onRetrySave })}
      />,
    )

    expect(screen.getByText("正在保存")).toHaveAttribute("aria-live", "polite")

    rerender(
      <DraggableModuleOutline
        {...createProps({ saveStatus: "saved", onRetrySave })}
      />,
    )
    expect(screen.getByText("已保存")).toHaveAttribute("aria-live", "polite")

    rerender(
      <DraggableModuleOutline
        {...createProps({ saveStatus: "error", onRetrySave })}
      />,
    )
    expect(screen.getByText("保存失败")).toHaveAttribute("aria-live", "polite")
    fireEvent.click(screen.getByRole("button", { name: "重试保存" }))
    expect(onRetrySave).toHaveBeenCalledTimes(1)
  })

  it("renders the empty anchor state", () => {
    render(<DraggableModuleOutline {...createProps({ anchors: [] })} />)

    expect(screen.getByText("暂无可用模块大纲。")).toBeInTheDocument()
  })

  it("commits a clamped drag position once on pointer up", () => {
    const props = createProps()
    render(<DraggableModuleOutline {...props} />)
    const outline = screen.getByLabelText("简历模块大纲")
    const handle = screen.getByTestId("module-outline-drag-handle")
    mockOutlineSize(outline)
    const capture = mockPointerCapture(handle)

    fireEvent.pointerDown(handle, { pointerId: 7, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 350, clientY: 250 })

    expect(outline).toHaveStyle({ left: "200px", top: "120px" })
    expect(props.onPositionCommit).not.toHaveBeenCalled()

    fireEvent.pointerUp(handle, { pointerId: 7, clientX: 350, clientY: 250 })

    expect(props.onPositionCommit).toHaveBeenCalledTimes(1)
    expect(props.onPositionCommit).toHaveBeenCalledWith({ x: 200, y: 120 })
    expect(capture.setPointerCapture).toHaveBeenCalledWith(7)
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(7)
  })

  it("commits the final drag position once on pointer cancel", () => {
    const props = createProps()
    render(<DraggableModuleOutline {...props} />)
    const outline = screen.getByLabelText("简历模块大纲")
    const handle = screen.getByTestId("module-outline-drag-handle")
    mockOutlineSize(outline)
    const capture = mockPointerCapture(handle)

    fireEvent.pointerDown(handle, { pointerId: 9, clientX: 20, clientY: 30 })
    fireEvent.pointerMove(handle, { pointerId: 9, clientX: -40, clientY: -50 })
    fireEvent.pointerCancel(handle, { pointerId: 9 })

    expect(props.onPositionCommit).toHaveBeenCalledTimes(1)
    expect(props.onPositionCommit).toHaveBeenCalledWith({ x: 0, y: 0 })
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(9)
  })

  it("commits the last moved position when pointer cancel has no coordinates", () => {
    const props = createProps()
    render(<DraggableModuleOutline {...props} />)
    const outline = screen.getByLabelText("简历模块大纲")
    const handle = screen.getByTestId("module-outline-drag-handle")
    mockOutlineSize(outline)
    mockPointerCapture(handle)

    fireEvent.pointerDown(handle, { pointerId: 9, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(handle, { pointerId: 9, clientX: 50, clientY: 60 })
    fireEvent.pointerCancel(handle, { pointerId: 9 })

    expect(props.onPositionCommit).toHaveBeenCalledTimes(1)
    expect(props.onPositionCommit).toHaveBeenCalledWith({ x: 60, y: 80 })
  })

  it("clamps the initial position when a drag ends without moving", () => {
    const props = createProps({ position: { x: 500, y: 400 } })
    render(<DraggableModuleOutline {...props} />)
    const outline = screen.getByLabelText("简历模块大纲")
    const handle = screen.getByTestId("module-outline-drag-handle")
    mockOutlineSize(outline)
    mockPointerCapture(handle)

    fireEvent.pointerDown(handle, { pointerId: 7, clientX: 10, clientY: 10 })
    fireEvent.pointerUp(handle, { pointerId: 7, clientX: 10, clientY: 10 })

    expect(props.onPositionCommit).toHaveBeenLastCalledWith({ x: 200, y: 120 })
  })

  it("commits the pointer up coordinates after the last move", () => {
    const props = createProps()
    render(<DraggableModuleOutline {...props} />)
    const outline = screen.getByLabelText("简历模块大纲")
    const handle = screen.getByTestId("module-outline-drag-handle")
    mockOutlineSize(outline)
    mockPointerCapture(handle)

    fireEvent.pointerDown(handle, { pointerId: 7, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 30, clientY: 40 })
    fireEvent.pointerUp(handle, { pointerId: 7, clientX: 80, clientY: 90 })

    expect(props.onPositionCommit).toHaveBeenCalledTimes(1)
    expect(props.onPositionCommit).toHaveBeenCalledWith({ x: 90, y: 110 })
  })

  it("ignores additional pointer downs until the active drag finishes", () => {
    const props = createProps()
    render(<DraggableModuleOutline {...props} />)
    const outline = screen.getByLabelText("简历模块大纲")
    const handle = screen.getByTestId("module-outline-drag-handle")
    mockOutlineSize(outline)
    const capture = mockPointerCapture(handle)

    fireEvent.pointerDown(handle, { pointerId: 7, clientX: 10, clientY: 10 })
    fireEvent.pointerDown(handle, { pointerId: 9, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(handle, { pointerId: 9, clientX: 200, clientY: 180 })
    fireEvent.pointerUp(handle, { pointerId: 9, clientX: 200, clientY: 180 })

    expect(props.onPositionCommit).not.toHaveBeenCalled()

    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 50, clientY: 60 })
    fireEvent.pointerUp(handle, { pointerId: 7, clientX: 50, clientY: 60 })

    expect(props.onPositionCommit).toHaveBeenCalledTimes(1)
    expect(props.onPositionCommit).toHaveBeenCalledWith({ x: 60, y: 80 })
    expect(capture.setPointerCapture).toHaveBeenCalledTimes(1)
    expect(capture.setPointerCapture).toHaveBeenCalledWith(7)
    expect(capture.releasePointerCapture).toHaveBeenCalledTimes(1)
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(7)
  })

  it("syncs changed position props while idle", () => {
    const props = createProps()
    const { rerender } = render(<DraggableModuleOutline {...props} />)
    const outline = screen.getByLabelText("简历模块大纲")

    expect(outline).toHaveStyle({ left: "20px", top: "30px" })

    rerender(
      <DraggableModuleOutline
        {...props}
        position={{ x: 72, y: 84 }}
      />,
    )

    expect(outline).toHaveStyle({ left: "72px", top: "84px" })
  })

  it("reclamps and commits the position when idle bounds shrink", () => {
    const props = createProps({ position: { x: 180, y: 100 } })
    const { rerender } = render(<DraggableModuleOutline {...props} />)
    const outline = screen.getByLabelText("简历模块大纲")
    mockOutlineSize(outline)

    rerender(
      <DraggableModuleOutline
        {...props}
        bounds={{ width: 160, height: 120 }}
      />,
    )

    expect(outline).toHaveStyle({ left: "60px", top: "40px" })
    expect(props.onPositionCommit).toHaveBeenLastCalledWith({ x: 60, y: 40 })
  })

  it("reclamps and commits the position when expanded content changes its size", () => {
    const props = createProps({
      expanded: false,
      position: { x: 180, y: 100 },
    })
    const { rerender } = render(<DraggableModuleOutline {...props} />)
    const outline = screen.getByLabelText("简历模块大纲")
    vi.spyOn(outline, "getBoundingClientRect").mockReturnValue({
      width: 100,
      height: 140,
    } as DOMRect)

    rerender(<DraggableModuleOutline {...props} expanded />)

    expect(outline).toHaveStyle({ left: "180px", top: "60px" })
    expect(props.onPositionCommit).toHaveBeenLastCalledWith({ x: 180, y: 60 })
  })

  it("reclamps the last moved position on pointer cancel after bounds shrink", () => {
    const props = createProps()
    const { rerender } = render(<DraggableModuleOutline {...props} />)
    const outline = screen.getByLabelText("简历模块大纲")
    const handle = screen.getByTestId("module-outline-drag-handle")
    mockOutlineSize(outline)
    mockPointerCapture(handle)

    fireEvent.pointerDown(handle, { pointerId: 9, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(handle, { pointerId: 9, clientX: 180, clientY: 150 })
    rerender(
      <DraggableModuleOutline
        {...props}
        bounds={{ width: 160, height: 120 }}
      />,
    )
    fireEvent.pointerCancel(handle, { pointerId: 9 })

    expect(props.onPositionCommit).toHaveBeenCalledTimes(1)
    expect(props.onPositionCommit).toHaveBeenCalledWith({ x: 60, y: 40 })
  })

  it("ignores non-primary pointer downs", () => {
    const props = createProps()
    render(<DraggableModuleOutline {...props} />)
    const outline = screen.getByLabelText("简历模块大纲")
    const handle = screen.getByTestId("module-outline-drag-handle")
    mockOutlineSize(outline)
    const capture = mockPointerCapture(handle)

    fireEvent.pointerDown(handle, {
      pointerId: 7,
      button: 1,
      clientX: 10,
      clientY: 10,
    })
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 100, clientY: 100 })
    fireEvent.pointerUp(handle, { pointerId: 7, clientX: 100, clientY: 100 })

    expect(props.onPositionCommit).not.toHaveBeenCalled()
    expect(capture.setPointerCapture).not.toHaveBeenCalled()
  })

  it("marks the floating outline as module-interaction-only", () => {
    render(<DraggableModuleOutline {...createProps()} />)

    expect(screen.getByLabelText("简历模块大纲")).toHaveClass(
      "td-module-interaction-only",
    )
  })
})
