import { Editor } from "@tiptap/core"
import { Markdown } from "@tiptap/markdown"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it } from "vitest"
import { MarkdownStarterKit } from "../../workspace/editor/MarkdownEditing"
import { MarkdownSourceEditing } from "../../workspace/editor/MarkdownSourceEditing"
import { defaultClassicA4Style } from "../../templates/data"
import { EditorReferencesProvider, useEditorReferences } from "./EditorReferences"
import { ReferenceTracker } from "./referenceTracker"
import { CanvasReferences } from "./CanvasReferences"

const editors: Editor[] = []
afterEach(() => { cleanup(); editors.splice(0).forEach((editor) => { const element = editor.view.dom.parentElement; editor.destroy(); element?.remove() }) })
function PendingReferences() {
  const context = useEditorReferences()
  return <pre data-testid="pending">{JSON.stringify(context?.pending)}</pre>
}

it("captures an AI reference directly from the focused Markdown source selection", async () => {
  const element = document.createElement("div")
  document.body.append(element)
  const editor = new Editor({ element, extensions: [MarkdownStarterKit, Markdown, MarkdownSourceEditing, ReferenceTracker],
    content: "<p><strong>目标</strong>内容</p>", editorProps: { handleScrollToSelection: () => true } })
  editors.push(editor)
  render(<EditorReferencesProvider documentId="document"><CanvasReferences editor={editor} canvasVersion={1} templateStyle={defaultClassicA4Style} /><PendingReferences /></EditorReferencesProvider>)
  await act(async () => {
    editor.view.someProp("handleClick", (handler) => handler(editor.view, 1, new MouseEvent("click")))
    await Promise.resolve()
  })
  const source = editor.view.dom.querySelector<HTMLTextAreaElement>("textarea")!
  act(() => { source.setSelectionRange(2, 4); fireEvent.select(source) })
  expect(document.activeElement).toBe(source)
  await screen.findByLabelText("引用选中文字")
  fireEvent.click(screen.getByText("添加为引用"))
  const pending = JSON.parse(screen.getByTestId("pending").textContent!)[0].reference
  expect(pending.text).toBe("目标")
  expect(pending.source).toMatchObject({ kind: "canvas", from: 1, to: 3, slice_content: [{ type: "text", text: "目标", marks: [{ type: "bold" }] }] })
})
