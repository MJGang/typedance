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

const threeColumnsDoc: ResumeDocJson = {
  type: "doc",
  content: [{
    type: "columns",
    attrs: { count: 3, gap: "default", widths: [30, 40, 30] },
    content: ["甲", "乙", "丙"].map((text) => ({
      type: "column",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    })),
  }],
}

function renderColumnsEditor(onChange = vi.fn(), editable = true, docJson = columnsDoc) {
  render(
    <TooltipProvider>
      <ResumeRichTextEditor
        ariaLabel="Resume text"
        templateStyle={defaultClassicA4Style}
        docJson={docJson}
        onChange={onChange}
        editable={editable}
      />
    </TooltipProvider>,
  )
  return onChange
}

function columnButton(label: string) {
  const button = document.querySelector<HTMLButtonElement>(`.td-columns-editor button[aria-label="${label}"]`)
  expect(button).not.toBeNull()
  return button as HTMLButtonElement
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
  it("inserts an empty column after the chosen column, including the last one", async () => {
    const onChange = renderColumnsEditor()

    await screen.findByText("左栏")
    fireEvent.click(columnButton("在第 1 栏后插入新栏"))
    await waitFor(() => {
      const columns = findFirstNodeByType(onChange.mock.lastCall?.[0]?.docJson, "columns")
      expect(columns?.content).toHaveLength(3)
      expect(columns?.content?.[0]?.content?.[0]?.content?.[0]).toMatchObject({ text: "左栏" })
      expect(columns?.content?.[1]?.content?.[0]?.content).toBeUndefined()
      expect(columns?.content?.[2]?.content?.[0]?.content?.[0]).toMatchObject({ text: "右栏" })
    })

    fireEvent.click(columnButton("在第 3 栏后插入新栏"))
    await waitFor(() => expect(findFirstNodeByType(onChange.mock.lastCall?.[0]?.docJson, "columns")?.content).toHaveLength(4))
  })

  it("stops offering add controls when there are six columns", async () => {
    renderColumnsEditor()
    await screen.findByText("左栏")

    for (let count = 2; count < 6; count += 1) {
      fireEvent.click(columnButton(`在第 ${count} 栏后插入新栏`))
      await waitFor(() => expect(screen.getAllByRole("separator", { name: /调整第 .* 栏与第 .* 栏宽度/ })).toHaveLength(count))
    }
    expect(document.querySelector('.td-columns-editor button[aria-label*="插入新栏"]')).toBeNull()
  })

  it("shows only the hovered add position's full-height guide", async () => {
    renderColumnsEditor(vi.fn(), true, threeColumnsDoc)
    await screen.findByText("甲")

    fireEvent.pointerEnter(columnButton("在第 2 栏后插入新栏"))
    expect(document.querySelectorAll(".td-column-add-guide")).toHaveLength(1)
    fireEvent.pointerLeave(columnButton("在第 2 栏后插入新栏"))
    expect(document.querySelectorAll(".td-column-add-guide")).toHaveLength(0)
  })

  it("shows a delete action from the column grip and fills the row after deletion", async () => {
    const onChange = renderColumnsEditor(vi.fn(), true, threeColumnsDoc)

    await screen.findByText("乙")
    fireEvent.click(columnButton("拖动第 2 栏"))
    fireEvent.click(columnButton("删除第 2 栏"))

    await waitFor(() => {
      const columns = findFirstNodeByType(onChange.mock.lastCall?.[0]?.docJson, "columns")
      expect(columns?.attrs?.widths).toEqual([70, 30])
      expect(columns?.content).toHaveLength(2)
    })
    expect(screen.queryByText("乙")).not.toBeInTheDocument()
  })

  it("clears the deleted last column's hover highlight", async () => {
    renderColumnsEditor(vi.fn(), true, threeColumnsDoc)
    await screen.findByText("丙")
    const grip = columnButton("拖动第 3 栏")
    fireEvent.pointerEnter(grip)
    fireEvent.click(grip)
    fireEvent.click(columnButton("删除第 3 栏"))

    await waitFor(() => expect(document.querySelector('.td-columns-editor[data-count="2"]')).not.toBeNull())
    expect(document.querySelector('.td-columns-controls-overlay [style*="grid-column: 5"]')).toBeNull()
  })

  it("unwraps the remaining content when deleting from a two-column layout", async () => {
    const onChange = renderColumnsEditor()

    await screen.findByText("左栏")
    fireEvent.click(columnButton("拖动第 1 栏"))
    fireEvent.click(columnButton("删除第 1 栏"))

    await waitFor(() => expect(findFirstNodeByType(onChange.mock.lastCall?.[0]?.docJson, "columns")).toBeUndefined())
    expect(screen.getByText("右栏")).toBeInTheDocument()
    expect(screen.queryByText("左栏")).not.toBeInTheDocument()
  })

  it("moves a column and its width with keyboard arrows", async () => {
    const onChange = renderColumnsEditor(vi.fn(), true, threeColumnsDoc)

    await screen.findByText("甲")
    fireEvent.keyDown(columnButton("拖动第 1 栏"), { key: "ArrowRight" })

    await waitFor(() => {
      const columns = findFirstNodeByType(onChange.mock.lastCall?.[0]?.docJson, "columns")
      expect(columns?.attrs?.widths).toEqual([40, 30, 30])
      expect(columns?.content?.[0]?.content?.[0]?.content?.[0]).toMatchObject({ text: "乙" })
    })
  })

  it("reorders the column under the grip when dragged to another column", async () => {
    const onChange = renderColumnsEditor(vi.fn(), true, threeColumnsDoc)
    await screen.findByText("甲")
    const grip = columnButton("拖动第 1 栏")
    const columns = grip.closest(".td-columns-editor") as HTMLElement
    const columnElements = [...columns.querySelectorAll<HTMLElement>(".td-column")]
    columnElements.forEach((column, index) => vi.spyOn(column, "getBoundingClientRect").mockReturnValue({
      x: index * 100, left: index * 100, right: index * 100 + 90, width: 90,
      y: 0, top: 0, bottom: 40, height: 40, toJSON: () => ({}),
    }))

    fireEvent.pointerDown(grip, { pointerId: 9, button: 0, clientX: 45 })
    fireEvent.pointerMove(grip, { pointerId: 9, clientX: 245 })
    fireEvent.pointerUp(grip, { pointerId: 9, clientX: 245 })

    await waitFor(() => {
      const next = findFirstNodeByType(onChange.mock.lastCall?.[0]?.docJson, "columns")
      expect(next?.attrs?.widths).toEqual([40, 30, 30])
      expect(next?.content?.map((column) => column.content?.[0]?.content?.[0]?.type === "text" ? (column.content?.[0]?.content?.[0] as { text?: string }).text : "")).toEqual(["乙", "丙", "甲"])
    })
    expect(document.body.style.cursor).toBe("")
  })

  it("does not reorder when the drag is released outside the column row", async () => {
    renderColumnsEditor(vi.fn(), true, threeColumnsDoc)
    await screen.findByText("甲")
    const grip = columnButton("拖动第 1 栏")
    const columns = grip.closest(".td-columns-editor") as HTMLElement
    const columnElements = [...columns.querySelectorAll<HTMLElement>(".td-column")]
    columnElements.forEach((column, index) => vi.spyOn(column, "getBoundingClientRect").mockReturnValue({
      x: index * 100, left: index * 100, right: index * 100 + 90, width: 90,
      y: 0, top: 0, bottom: 40, height: 40, toJSON: () => ({}),
    }))

    fireEvent.pointerDown(grip, { pointerId: 10, button: 0, clientX: 45, clientY: 10 })
    fireEvent.pointerMove(grip, { pointerId: 10, clientX: 245, clientY: 10 })
    fireEvent.pointerMove(grip, { pointerId: 10, clientX: 245, clientY: 100 })
    fireEvent.pointerUp(grip, { pointerId: 10, clientX: 245, clientY: 100 })

    expect([...columns.querySelectorAll(".td-column p")].map((paragraph) => paragraph.textContent)).toEqual(["甲", "乙", "丙"])
    expect(document.body.style.cursor).toBe("")
  })

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
    expect(screen.queryByRole("button", { name: /插入新栏|拖动第/ })).not.toBeInTheDocument()
  })
})
