import "@testing-library/jest-dom/vitest"
import { createRef } from "react"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { prepareEditorOperations } from "@/api"
import { prepareWithSidecar } from "@/test/sidecarEditor"
import { TooltipProvider } from "@/components/ui/tooltip"
import { defaultClassicA4Style } from "../../templates/data"
import { ResumeRichTextEditor, type ResumeRichTextEditorHandle } from "./ResumeRichTextEditor"

vi.mock("@/api", () => ({ prepareEditorOperations: vi.fn() }))
beforeEach(() => { vi.mocked(prepareEditorOperations).mockImplementation(async (doc, operations) => prepareWithSidecar(doc, operations)) })
beforeAll(() => {
  globalThis.ResizeObserver = class { observe() {}; unobserve() {}; disconnect() {} }
  // jsdom 不实现文字范围的布局；实际滚动与焦点另由 Chromium 验收。
  Object.defineProperties(Range.prototype, {
    getClientRects: { configurable: true, value: () => [] },
    getBoundingClientRect: { configurable: true, value: () => new DOMRect() },
  })
})
afterEach(() => { cleanup(); vi.resetAllMocks() })

describe("bold toolbar operations", () => {
  it.each(["paragraph", "heading", "bulletList", "orderedList", "nestedList"])("adds and removes bold from selected text in %s without changing other text or marks", async (container) => {
    const paragraph = { type: container === "heading" ? "heading" : "paragraph", attrs: { canvasNodeId: "target", ...(container === "heading" ? { level: 2 } : {}) },
      content: [{ type: "text", text: "保留重点内容", marks: [{ type: "italic" }] }] }
    const listItem = { type: "listItem", content: [paragraph] }
    const content = container === "paragraph" || container === "heading" ? [paragraph]
      : container === "nestedList" ? [{ type: "bulletList", content: [{ type: "listItem", content: [
        { type: "paragraph", content: [{ type: "text", text: "父级" }] },
        { type: "bulletList", content: [listItem] },
      ] }] }]
        : [{ type: container, content: [listItem] }]
    const path = container === "paragraph" || container === "heading" ? [0]
      : container === "nestedList" ? [0, 0, 1, 0, 0] : [0, 0, 0]
    const start = container === "paragraph" || container === "heading" ? 3 : container === "nestedList" ? 11 : 5
    const ref = createRef<ResumeRichTextEditorHandle>(), onChange = vi.fn()
    render(<TooltipProvider><ResumeRichTextEditor ref={ref} ariaLabel="Resume text" templateStyle={defaultClassicA4Style}
      docJson={{ type: "doc", content }} onChange={onChange} /></TooltipProvider>)
    act(() => ref.current?.setTextSelection({ anchor: start, head: start + 2 }))

    const bold = screen.getByLabelText("加粗", { exact: true })
    expect(bold).toBeEnabled()
    fireEvent.click(bold)
    await waitFor(() => expect(screen.getByLabelText("Resume text").querySelector("strong")).toHaveTextContent("重点"))
    expect(prepareEditorOperations).toHaveBeenLastCalledWith(expect.anything(), [{ capability: "text.format", parameters: {
      path, text: "重点", occurrence: 0, mark: "bold", enabled: true,
    } }], defaultClassicA4Style)
    const result = onChange.mock.lastCall![0].docJson
    const target = path.reduce((node, index) => node.content[index], result)
    expect(target.attrs.canvasNodeId).toBe("target")
    expect(target.content.map((node: { text: string }) => node.text)).toEqual(["保留", "重点", "内容"])
    expect(target.content.every((node: { marks: Array<{ type: string }> }) => node.marks.some((mark) => mark.type === "italic"))).toBe(true)
    expect(bold).toHaveAttribute("data-active", "true")

    fireEvent.click(bold)
    await waitFor(() => expect(screen.getByLabelText("Resume text").querySelector("strong")).toBeNull())
    expect(bold).not.toHaveAttribute("data-active", "true")
    const restored = path.reduce((node, index) => node.content[index], onChange.mock.lastCall![0].docJson)
    expect(restored).toMatchObject(paragraph)
    expect(prepareEditorOperations).toHaveBeenCalledTimes(2)
  }, 15_000)
})

describe("heading to list toolbar operations", () => {
  it.each([1, 2, 3])("converts H%i and selected body together through one backend transaction", async (level) => {
    const ref = createRef<ResumeRichTextEditorHandle>()
    const onChange = vi.fn()
    render(<TooltipProvider><ResumeRichTextEditor ref={ref} ariaLabel="Resume text" templateStyle={defaultClassicA4Style}
      docJson={{ type: "doc", content: [
        { type: "heading", attrs: { level, canvasNodeId: "header", sourceBlockId: "source" }, content: [{ type: "text", text: "标题", marks: [{ type: "bold" }] }] },
        { type: "paragraph", attrs: { canvasNodeId: "body" }, content: [{ type: "text", text: "正文" }] },
      ] }} onChange={onChange} /></TooltipProvider>)
    act(() => ref.current?.setTextSelection(level === 2 ? { anchor: 1, head: 7 } : { anchor: 2, head: 2 }))
    fireEvent.keyDown(screen.getByLabelText(level === 2 ? "有序列表" : "无序列表", { exact: true }), { key: "Enter" })
    fireEvent.click(await screen.findByLabelText(level === 2 ? "数字编号" : "实心圆", { exact: true }))
    await waitFor(() => expect(onChange.mock.lastCall?.[0].docJson.content[0].type).toBe(level === 2 ? "orderedList" : "bulletList"))
    const list = onChange.mock.lastCall![0].docJson.content[0]
    expect(list.content).toHaveLength(level === 2 ? 2 : 1)
    expect(list.content[0].content[0]).toMatchObject({ type: "paragraph", attrs: { canvasNodeId: "header", sourceBlockId: "source" }, content: [{ type: "text", text: "标题", marks: [{ type: "bold" }] }] })
    expect(prepareEditorOperations).toHaveBeenCalledTimes(1)
    expect(vi.mocked(prepareEditorOperations).mock.calls[0][1].map((operation) => operation.capability)).toEqual(["block.type", "list.convert"])
  })
})

describe("separator toolbar operation", () => {
  it.each(["doc", "column", "listItem"])("inserts through the backend after the selected block in %s and preserves its text", async (container) => {
    const paragraph = { type: "paragraph", content: [{ type: "text", text: "保留选中文字", marks: [{ type: "bold" }] }] }
    const content = container === "doc" ? [paragraph]
      : container === "column" ? [{ type: "columns", attrs: { count: 2 }, content: [{ type: "column", content: [paragraph] }, { type: "column", content: [{ type: "paragraph" }] }] }]
        : [{ type: "bulletList", content: [{ type: "listItem", content: [paragraph] }] }]
    const ref = createRef<ResumeRichTextEditorHandle>(), onChange = vi.fn()
    render(<TooltipProvider><ResumeRichTextEditor ref={ref} ariaLabel="Resume text" templateStyle={defaultClassicA4Style}
      docJson={{ type: "doc", content }} onChange={onChange} /></TooltipProvider>)
    const start = container === "doc" ? 2 : 4
    act(() => ref.current?.setTextSelection({ anchor: start, head: start + 2 }))
    fireEvent.click(screen.getByLabelText("分割线", { exact: true }))
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const result = onChange.mock.lastCall![0].docJson
    const blocks = container === "doc" ? result.content : result.content[0].content[0].content
    expect(blocks.slice(0, 2).map((node: { type: string }) => node.type)).toEqual(["paragraph", "horizontalRule"])
    expect(blocks[0].content).toEqual(paragraph.content)
    expect(blocks[1].attrs.canvasNodeId).toMatch(/^canvas_/)
    expect(prepareEditorOperations).toHaveBeenCalledTimes(1)
    expect(vi.mocked(prepareEditorOperations).mock.calls[0][1][0].capability).toBe("blocks.insert")
    fireEvent.keyDown(screen.getByLabelText("Resume text"), { key: "z", code: "KeyZ", ctrlKey: true })
    await waitFor(() => expect(screen.getByLabelText("Resume text").querySelector("hr")).toBeNull())
    const restored = onChange.mock.lastCall![0].docJson
    const restoredBlocks = container === "doc" ? restored.content : restored.content[0].content[0].content
    expect(restoredBlocks.map((node: { type: string }) => node.type)).toEqual(["paragraph"])
  })
})
