import "@testing-library/jest-dom/vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeAll, describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { defaultClassicA4Style } from "../../templates/data"
import type { ResumeDocJson } from "../editor"
import { ResumeRichTextEditor } from "./ResumeRichTextEditor"

type TestJsonNode = {
  type?: string
  attrs?: Record<string, unknown>
  content?: TestJsonNode[]
}

function findFirstNodeByType(node: TestJsonNode, type: string): TestJsonNode | undefined {
  if (node.type === type) return node
  for (const child of node.content ?? []) {
    const match = findFirstNodeByType(child, type)
    if (match) return match
  }
  return undefined
}

const columnsDoc: ResumeDocJson = {
  type: "doc",
  content: [{
    type: "columns",
    attrs: { count: 2, gap: "default", widths: [50, 50] },
    content: [
      { type: "column", content: [{ type: "paragraph", content: [{ type: "text", text: "左栏" }] }] },
      { type: "column", content: [{ type: "paragraph", content: [{ type: "text", text: "右栏" }] }] },
    ],
  }],
}

function renderColumnsEditor(onChange = vi.fn(), editable = true) {
  render(
    <TooltipProvider>
      <ResumeRichTextEditor
        ariaLabel="Resume text"
        templateStyle={defaultClassicA4Style}
        docJson={columnsDoc}
        onChange={onChange}
        editable={editable}
      />
    </TooltipProvider>,
  )
  return onChange
}

beforeAll(() => {
  class PointerEventMock extends MouseEvent {
    pointerId: number

    constructor(type: string, eventInitDict: PointerEventInit = {}) {
      super(type, eventInitDict)
      this.pointerId = eventInitDict.pointerId ?? 0
    }
  }

  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  globalThis.PointerEvent = PointerEventMock as typeof PointerEvent
  globalThis.ResizeObserver = ResizeObserverMock
})

describe("ColumnsNodeView", () => {
  it("does not render a separate arrow inside the resize handle", async () => {
    renderColumnsEditor()

    const handle = await screen.findByRole("separator", { name: /调整第 1 栏/ })
    expect(handle.querySelector("svg")).toBeNull()
  })

  it("persists keyboard column resizing in the document", async () => {
    const onChange = renderColumnsEditor()

    fireEvent.keyDown(await screen.findByRole("separator", { name: "调整第 1 栏与第 2 栏宽度" }), { key: "ArrowRight" })

    await waitFor(() => {
      const change = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0]
      expect(findFirstNodeByType(change?.docJson, "columns")?.attrs?.widths).toEqual([55, 45])
    })
  })

  it("commits the final pointer position and restores document interaction", async () => {
    const onChange = renderColumnsEditor()
    const handle = await screen.findByRole("separator", { name: "调整第 1 栏与第 2 栏宽度" })
    const columns = handle.closest(".td-columns-editor") as HTMLElement
    vi.spyOn(columns, "getBoundingClientRect").mockReturnValue({
      width: 210,
      height: 40,
      top: 0,
      right: 210,
      bottom: 40,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    fireEvent.pointerDown(handle, { pointerId: 7, button: 0, clientX: 100 })
    expect(document.body.style.cursor).toBe("ew-resize")
    expect(document.body).toHaveClass("td-column-resizing")
    expect(document.body.style.userSelect).toBe("none")
    fireEvent.pointerUp(handle, { pointerId: 7, clientX: 140 })

    await waitFor(() => {
      const change = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0]
      expect(findFirstNodeByType(change?.docJson, "columns")?.attrs?.widths).toEqual([70, 30])
    })
    expect(document.body.style.cursor).toBe("")
    expect(document.body.style.userSelect).toBe("")
    expect(document.body).not.toHaveClass("td-column-resizing")
  })

  it("cancels an active resize on window blur", async () => {
    renderColumnsEditor()
    const handle = await screen.findByRole("separator", { name: "调整第 1 栏与第 2 栏宽度" })
    const columns = handle.closest(".td-columns-editor") as HTMLElement
    vi.spyOn(columns, "getBoundingClientRect").mockReturnValue({
      width: 210,
      height: 40,
      top: 0,
      right: 210,
      bottom: 40,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    fireEvent.pointerDown(handle, { pointerId: 8, button: 0, clientX: 100 })
    fireEvent.pointerMove(handle, { pointerId: 8, clientX: 140 })
    fireEvent(window, new Event("blur"))

    await waitFor(() => expect(columns).not.toHaveAttribute("data-resizing"))
    expect(columns).toHaveAttribute("data-widths", "50,50")
    expect(document.body.style.cursor).toBe("")
    expect(document.body.style.userSelect).toBe("")
  })

  it("does not expose resize controls in read-only previews", async () => {
    renderColumnsEditor(vi.fn(), false)

    await screen.findByText("左栏")
    expect(screen.queryByRole("separator")).not.toBeInTheDocument()
  })
})
