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
beforeAll(() => { globalThis.ResizeObserver = class { observe() {}; unobserve() {}; disconnect() {} } })
afterEach(() => { cleanup(); vi.resetAllMocks() })

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
