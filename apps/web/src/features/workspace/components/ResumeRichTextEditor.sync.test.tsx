import { act, cleanup, render, waitFor } from "@testing-library/react"
import type { Editor } from "@tiptap/core"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { defaultClassicA4Style } from "../../templates/data"
import { referenceTrackerKey } from "../../revision/references/referenceTracker"
import { ResumeRichTextEditor } from "./ResumeRichTextEditor"

let activeEditor: Editor | null = null
vi.mock("../../revision/references/CanvasReferences", () => ({ CanvasReferences: ({ editor }: { editor: Editor | null }) => { activeEditor = editor; return null } }))
beforeAll(() => { globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } })
afterEach(() => { cleanup(); activeEditor = null })

describe("saved canvas synchronization", () => {
  it("preserves revision and undo when backend JSON changes field order without changing content", async () => {
    const original = { type: "doc" as const, content: [{ type: "paragraph", attrs: { canvasNodeId: "node", sourceBlockId: "source" }, content: [{ type: "text", text: "保留原文" }] }] }
    const onChange = vi.fn()
    const renderEditor = (doc: typeof original) => <TooltipProvider><ResumeRichTextEditor ariaLabel="同步画布" templateStyle={defaultClassicA4Style} docJson={doc} onChange={onChange} /></TooltipProvider>
    const view = render(renderEditor(original))
    await waitFor(() => expect(activeEditor).not.toBeNull())
    const editor = activeEditor!
    act(() => { editor.commands.insertContentAt(1, "后续编辑") })
    const current = editor.state.doc
    const revision = referenceTrackerKey.getState(editor.state)?.revision
    const reverse = (value: unknown): unknown => Array.isArray(value) ? value.map(reverse) : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverse(child)])) : value
    view.rerender(renderEditor(reverse(editor.getJSON()) as typeof original))
    await act(async () => {})
    expect(editor.state.doc).toBe(current)
    expect(referenceTrackerKey.getState(editor.state)?.revision).toBe(revision)
    act(() => { editor.commands.undo() })
    expect(editor.getText()).toBe("保留原文")
  })
})
