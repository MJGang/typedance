import { afterEach, describe, expect, it, vi } from "vitest"
import { waitFor } from "@testing-library/react"
import { Editor } from "@tiptap/core"
import StarterKit from "@tiptap/starter-kit"
import { prepareEditorOperations } from "@/api"
import { executeEditorOperations } from "./editorCommands"

vi.mock("@/api", () => ({ prepareEditorOperations: vi.fn() }))
const editors: Editor[] = []
afterEach(() => {
  editors.splice(0).forEach((editor) => {
    const element = editor.view.dom.parentElement
    editor.destroy()
    element?.remove()
  })
  vi.resetAllMocks()
  document.querySelectorAll("[data-test-toolbar]").forEach((node) => node.remove())
})

describe("manual editor commands", () => {
  it("restores editor focus after an async toolbar edit and preserves the mapped selection", async () => {
    const element = document.createElement("div")
    document.body.append(element)
    const editor = new Editor({ element, extensions: [StarterKit], content: "<p>继续编辑简历</p>", editorProps: { handleScrollToSelection: () => true } })
    editors.push(editor)
    editor.view.dom.tabIndex = 0
    editor.commands.setTextSelection({ from: 1, to: 3 })
    const selected = editor.state.selection
    const toolbar = document.createElement("button")
    toolbar.dataset.testToolbar = "true"
    document.body.append(toolbar)
    toolbar.focus()
    const after = editor.getJSON()
    after.content![0].content![0].marks = [{ type: "bold" }]
    vi.mocked(prepareEditorOperations).mockResolvedValue({ doc_json: after, effects: [], catalog_revision: "current" })
    expect(await executeEditorOperations(editor, [{ capability: "text.format", parameters: { path: [0], text: "继续", mark: "bold" } }])).toBe(true)
    await waitFor(() => expect(document.activeElement).toBe(editor.view.dom))
    expect(editor.state.selection.eq(selected)).toBe(true)
    expect(editor.getText()).toBe("继续编辑简历")
  })
})
