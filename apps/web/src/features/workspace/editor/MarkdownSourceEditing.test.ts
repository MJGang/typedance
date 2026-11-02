import { Editor, Extension, Mark, type Extensions, type JSONContent } from "@tiptap/core"
import { Markdown } from "@tiptap/markdown"
import { afterEach, describe, expect, it } from "vitest"
import { MarkdownPaste, MarkdownStarterKit } from "./MarkdownEditing"
import { MarkdownSourceEditing, markdownSourceKey } from "./MarkdownSourceEditing"

const editors: Editor[] = []
function createEditor(content: string, extra: Extensions = []) {
  const element = document.createElement("div")
  document.body.append(element)
  const editor = new Editor({ element, extensions: [MarkdownStarterKit, Markdown, MarkdownPaste, MarkdownSourceEditing, ...extra], content,
    editorProps: { handleScrollToSelection: () => true } })
  editors.push(editor)
  return editor
}
async function enter(editor: Editor, text: string, marker = false) {
  let position = 1
  editor.state.doc.descendants((node, pos) => { if (node.isText && node.text?.includes(text)) position = pos })
  editor.view.someProp("handleClick", (handler) => handler(editor.view, position, new MouseEvent("click", { clientX: marker ? -1 : 1 })))
  await Promise.resolve()
  await Promise.resolve()
  return editor.view.dom.querySelector<HTMLTextAreaElement>("[data-markdown-source-input]")!
}
function input(source: HTMLTextAreaElement, text: string) {
  source.value = text
  source.setSelectionRange(text.length, text.length)
  source.dispatchEvent(new Event("input", { bubbles: true }))
}
afterEach(() => { editors.splice(0).forEach((editor) => { const root = editor.view.dom.parentElement; editor.destroy(); root?.remove() }) })

describe("local Markdown source editing", () => {
  it("opens and focuses source after the editor recreates plugin views", async () => {
    const editor = createEditor("<h2>项目背景</h2>")
    editor.view.setProps({ plugins: [] })
    const source = await enter(editor, "项目背景")
    expect(source.value).toBe("## 项目背景")
    expect(document.activeElement).toBe(source)
    input(source, "## 修改背景")
    source.blur()
    expect(editor.state.doc.textContent).toBe("修改背景")
  })

  it.each(["ul", "ol"])("keeps %s content rendered until its marker is targeted", async (tag) => {
    const editor = createEditor(`<${tag}><li><p>普通内容 <strong>加粗内容</strong> 其他文字</p></li></${tag}>`)
    const plain = await enter(editor, "普通内容")
    expect(plain).toBeNull()
    const marked = await enter(editor, "加粗内容")
    expect(marked.value).toBe("**加粗内容**")
    expect(editor.view.dom.querySelector("li[data-markdown-source-list]")).toBeNull()
    input(marked, "**调整**")
    marked.blur()
    expect(editor.state.doc.textContent).toBe("普通内容 调整 其他文字")
    const marker = await enter(editor, "普通内容", true)
    expect(marker.value).toBe(tag === "ul" ? "- " : "1. ")
    expect(editor.view.dom.querySelector("strong")?.textContent).toBe("调整")
  })

  it("maps a clicked Chinese heading position to the same character in source", async () => {
    const editor = createEditor("<h2>项目背景</h2><p>面向 ETC 业务人员</p>")
    editor.view.someProp("handleClick", (handler) => handler(editor.view, 4, new MouseEvent("click")))
    await Promise.resolve()
    await Promise.resolve()
    const source = editor.view.dom.querySelector<HTMLTextAreaElement>("textarea")!
    expect(source.value).toBe("## 项目背景")
    expect(source.selectionStart).toBe(6)
    expect(document.activeElement).toBe(source)
  })

  it("isolates nested inline syntax without expanding the surrounding list or outer mark", async () => {
    const editor = createEditor("<ul><li><p><strong>前缀<em>嵌套</em>后缀</strong>正文</p></li></ul>")
    const source = await enter(editor, "嵌套")
    expect(source.value).toBe("*嵌套*")
    input(source, "*修改*")
    source.blur()
    expect(editor.view.dom.querySelector("li strong")?.textContent).toBe("前缀修改后缀")
    expect(editor.view.dom.querySelector("li em")?.textContent).toBe("修改")
    expect(editor.state.doc.textContent).toBe("前缀修改后缀正文")
  })

  it("keeps inline source mounted while intermediate Markdown becomes a divider", async () => {
    const editor = createEditor("<p><strong>原文</strong></p><p>相邻正文</p>")
    await enter(editor, "原文")
    const markdown = "***新文字***"
    for (let end = 1; end <= markdown.length; end++) {
      const source = editor.view.dom.querySelector<HTMLTextAreaElement>("textarea")!
      input(source, markdown.slice(0, end))
      await Promise.resolve()
      const mounted = editor.view.dom.querySelector<HTMLTextAreaElement>("textarea")
      expect(mounted).not.toBeNull()
      expect(mounted?.value).toBe(markdown.slice(0, end))
      expect(document.activeElement).toBe(mounted)
      expect(() => editor.state.doc.check()).not.toThrow()
    }
    editor.view.dom.querySelector<HTMLTextAreaElement>("textarea")!.blur()
    expect(editor.view.dom.querySelector("strong em")?.textContent).toBe("新文字")
    expect(editor.state.doc.lastChild?.textContent).toBe("相邻正文")
  })

  it("reveals only the active marked text and preserves the rest of its paragraph", async () => {
    const editor = createEditor("<p><strong>当前</strong>内容</p><p><em>相邻段落</em></p>")
    const source = await enter(editor, "当前")
    expect(source.value).toBe("**当前**")
    expect(editor.view.dom.querySelectorAll("textarea")).toHaveLength(1)
    expect(editor.view.dom.querySelector("p:last-child em")?.textContent).toBe("相邻段落")
    input(source, "**Agent 应用：** 熟悉、**意图识别**、*斜体*和`代码`")
    expect(source.value).toContain("**意图识别**")
    expect(editor.getJSON().content?.[0].content?.some((node) => node.marks?.some((mark) => mark.type === "bold"))).toBe(true)
    expect(editor.state.doc.textContent).not.toContain("**")
    source.blur()
    expect(editor.view.dom.querySelector("textarea")).toBeNull()
    expect(editor.view.dom.querySelector("strong")?.textContent).toBe("Agent 应用：")
    expect(editor.view.dom.querySelector("code")?.textContent).toBe("代码")
    expect(editor.state.doc.firstChild?.textContent).toMatch(/内容$/)
  })

  it("edits one list item without changing its siblings or nesting", async () => {
    const editor = createEditor("<ul><li><p>前项</p></li><li><p><strong>当前</strong></p><ul><li><p>子项</p></li></ul></li><li><p>后项</p></li></ul>")
    const before = editor.getJSON().content![0].content! as JSONContent[]
    const source = await enter(editor, "当前")
    expect(source.value).toBe("**当前**")
    expect(source.value).not.toContain("前项")
    expect(source.value).not.toContain("后项")
    input(source, source.value.replace("当前", "修改"))
    source.blur()
    const items = editor.getJSON().content![0].content! as JSONContent[]
    expect(items[0]).toEqual(before[0])
    expect(items[2]).toEqual(before[2])
    expect(items[1].content![1]).toEqual(before[1].content![1])
    expect(editor.view.dom.querySelector("strong")?.textContent).toBe("修改")
  })

  it("converts the active region to blocks and keeps adjacent paragraphs", async () => {
    const editor = createEditor("<p>当前</p><p>保留</p>")
    const source = await enter(editor, "当前")
    input(source, "### 标题\n\n- **第一项**\n- 第二项")
    expect(editor.view.dom.querySelectorAll("textarea")).toHaveLength(1)
    source.blur()
    expect(editor.view.dom.querySelector("h3")?.textContent).toBe("标题")
    expect(editor.view.dom.querySelectorAll("li")).toHaveLength(2)
    expect(editor.state.doc.lastChild?.textContent).toBe("保留")
  })

  it("changes a middle list item into a paragraph without deleting adjacent items", async () => {
    const editor = createEditor("<ul><li><p>前项</p></li><li><p>当前</p></li><li><p>后项</p></li></ul>")
    const source = await enter(editor, "当前", true)
    expect(source.value).toBe("- ")
    input(source, "")
    editor.view.dom.querySelector<HTMLTextAreaElement>("textarea")!.blur()
    const paragraph = await enter(editor, "当前")
    input(paragraph, "**独立段落更新**")
    editor.view.dom.querySelector<HTMLTextAreaElement>("textarea")!.blur()
    expect(editor.getJSON().content!.slice(0, 3).map((node) => node.type)).toEqual(["bulletList", "paragraph", "bulletList"])
    expect(editor.state.doc.textContent).toBe("前项独立段落更新后项")
  })

  it("keeps source widgets out of persisted JSON and supports native undo", async () => {
    const editor = createEditor("<p><strong>当前</strong></p>")
    const source = await enter(editor, "当前")
    input(source, "**修改**")
    const persisted = editor.getJSON()
    expect(JSON.stringify(persisted)).not.toContain("markdownSource")
    source.blur()
    editor.commands.undo()
    expect(editor.state.doc.textContent).toBe("当前")
    expect(markdownSourceKey.getState(editor.state)).toBeNull()
    editor.commands.redo()
    expect(editor.state.doc.textContent).toBe("修改")
  })

  it("preserves edits outside the active region while continuing source editing", async () => {
    const editor = createEditor("<p>当前</p>")
    const source = await enter(editor, "当前")
    input(source, "**修改**")
    editor.commands.insertContentAt(editor.state.doc.content.size, "<p>外部编辑</p>")
    expect(markdownSourceKey.getState(editor.state)).not.toBeNull()
    input(source, "**继续修改**")
    source.blur()
    expect(editor.state.doc.textContent).toBe("继续修改外部编辑")
  })

  it("closes source editing when an external change touches the active region", async () => {
    const editor = createEditor("<p>当前</p>")
    const source = await enter(editor, "当前")
    input(source, "**修改**")
    editor.commands.insertContentAt(1, "外部")
    expect(markdownSourceKey.getState(editor.state)).toBeNull()
    expect(editor.view.dom.querySelector("textarea")).toBeNull()
    expect(editor.state.doc.textContent).toBe("外部修改")
  })

  it("keeps local text styles while changing Markdown source", async () => {
    const InlineStyle = Mark.create({ name: "inlineStyle",
      addAttributes: () => ({ color: { default: null, parseHTML: (element: HTMLElement) => element.style.color } }),
      parseHTML: () => [{ tag: "span[data-td-inline-style]" }],
      renderHTML: ({ mark }) => ["span", { "data-td-inline-style": "", style: `color: ${mark.attrs.color}` }, 0],
    })
    const editor = createEditor('<p><span data-td-inline-style style="color: #123456">当前</span>保留</p>', [InlineStyle])
    const before = editor.getJSON().content![0].content![0].marks
    const source = await enter(editor, "当前")
    input(source, source.value.replace("当前", "修改"))
    source.blur()
    expect(editor.getJSON().content![0].content![0].marks).toEqual(before)
  })

  it("moves to the next paragraph at the end of the current source", async () => {
    const editor = createEditor("<p>当前</p><p><strong>后段</strong></p>")
    const source = await enter(editor, "当前")
    source.setSelectionRange(source.value.length, source.value.length)
    source.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
    await Promise.resolve()
    const next = editor.view.dom.querySelector<HTMLTextAreaElement>("textarea")!
    expect(next.value).toBe("**后段**")
    expect(editor.view.dom.querySelectorAll("textarea")).toHaveLength(1)
  })

  it("restores editor focus when arrow navigation enters rendered list text", async () => {
    const editor = createEditor("<p>当前段落</p><ul><li><p>列表正文</p></li></ul>")
    const source = await enter(editor, "当前段落")
    source.setSelectionRange(source.value.length, source.value.length)
    source.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
    await Promise.resolve()
    expect(editor.view.dom.querySelector("textarea")).toBeNull()
    expect(document.activeElement).toBe(editor.view.dom)
    expect(editor.state.selection.$from.parent.textContent).toBe("列表正文")
  })

  it("preserves node identities throughout an unchanged nested list structure", async () => {
    const Ids = Extension.create({ name: "testIds", addGlobalAttributes: () => [{ types: ["paragraph", "listItem"], attributes: {
      canvasNodeId: { default: null, parseHTML: (element: HTMLElement) => element.getAttribute("data-canvas-node-id") },
    } }] })
    const editor = createEditor('<ul><li data-canvas-node-id="item"><p data-canvas-node-id="main"><strong>当前</strong></p><ul><li data-canvas-node-id="nested-item"><p data-canvas-node-id="nested">子项</p></li></ul></li></ul>', [Ids])
    const source = await enter(editor, "当前")
    input(source, source.value.replace("当前", "修改"))
    source.blur()
    const list = editor.getJSON().content![0] as JSONContent
    expect(list.content![0].attrs?.canvasNodeId).toBe("item")
    expect(list.content![0].content![0].attrs?.canvasNodeId).toBe("main")
    const nested = list.content![0].content![1].content![0]
    expect(nested.attrs?.canvasNodeId).toBe("nested-item")
    expect(nested.content![0].attrs?.canvasNodeId).toBe("nested")
  })

  it("flushes pending IME text before returning to rendered content", async () => {
    const editor = createEditor("<p>当前</p>")
    const source = await enter(editor, "当前")
    source.value = "**中文输入**"
    source.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }))
    source.blur()
    expect(editor.state.doc.textContent).toBe("中文输入")
    expect(editor.view.dom.querySelector("strong")?.textContent).toBe("中文输入")
  })

  it("supports formatting shortcuts within the active source selection", async () => {
    const editor = createEditor("<p>当前内容</p>")
    const source = await enter(editor, "当前")
    source.setSelectionRange(0, 2)
    source.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ctrlKey: true, bubbles: true, cancelable: true }))
    expect(source.value).toBe("**当前**内容")
    expect(editor.view.dom.querySelector("strong")?.textContent).toBe("当前")
    source.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ctrlKey: true, bubbles: true, cancelable: true }))
    expect(source.value).toBe("当前内容")
    expect(editor.view.dom.querySelector("strong")).toBeNull()
  })

  it.each(["![图](https://example.com/image.png)", "| A | B |\n| --- | --- |\n| 1 | 2 |"])("does not drop content outside the editor schema: %s", async (markdown) => {
    const editor = createEditor("<p>当前</p>")
    const source = await enter(editor, "当前")
    input(source, markdown)
    source.blur()
    expect(editor.state.doc.textContent).toContain(markdown)
  })

  it("preserves image notation alongside code and supported formatting", async () => {
    const editor = createEditor("<p>当前</p>")
    const source = await enter(editor, "当前")
    const image = "![图](https://example.com/image.png)"
    input(source, `\`${image}\` 和 **加粗** ${image}`)
    source.blur()
    expect(editor.view.dom.querySelector("code")?.textContent).toBe(image)
    expect(editor.view.dom.querySelector("strong")?.textContent).toBe("加粗")
    expect(editor.state.doc.textContent).toBe(`${image} 和 加粗 ${image}`)
  })

  it("keeps every intermediate state valid while typing a nested list after a heading", async () => {
    const editor = createEditor("<h3>当前</h3>")
    await enter(editor, "当前")
    const markdown = "- 第一项\n  - 子项"
    for (let end = 1; end <= markdown.length; end++) {
      input(editor.view.dom.querySelector<HTMLTextAreaElement>("textarea")!, markdown.slice(0, end))
      expect(() => editor.state.doc.check()).not.toThrow()
    }
    editor.view.dom.querySelector<HTMLTextAreaElement>("textarea")!.blur()
    expect(editor.view.dom.querySelector("ul ul li")?.textContent).toBe("子项")
  })

  it("maps source selections to document text without moving textarea focus", async () => {
    const editor = createEditor("<p><strong>当前</strong>内容</p>")
    const source = await enter(editor, "当前")
    source.setSelectionRange(2, 4, "backward")
    source.dispatchEvent(new Event("select", { bubbles: true }))
    expect(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to)).toBe("当前")
    expect(editor.state.selection.anchor).toBeGreaterThan(editor.state.selection.head)
    expect(document.activeElement).toBe(source)
  })

  it.each(["bold", "italic", "underline", "inlineStyle"])("keeps explicitly enabled %s when typing into an empty paragraph", async (mark) => {
    const InlineStyle = Mark.create({ name: "inlineStyle", addAttributes: () => ({ color: { default: null } }), renderHTML: () => ["span", 0] })
    const editor = createEditor("<p></p>", mark === "inlineStyle" ? [InlineStyle] : [])
    editor.commands.setMark(mark, mark === "inlineStyle" ? { color: "#123456" } : {})
    const position = editor.state.selection.from
    const handled = editor.view.someProp("handleTextInput", (handler) => handler(editor.view, position, position, "首",
      () => editor.state.tr.insertText("首", position)))
    expect(handled).toBe(true)
    await Promise.resolve()
    const source = editor.view.dom.querySelector<HTMLTextAreaElement>("textarea")!
    source.setRangeText("字", source.selectionStart, source.selectionEnd, "end")
    source.dispatchEvent(new Event("input", { bubbles: true }))
    source.blur()
    expect(editor.state.doc.textContent).toBe("首字")
    const content = editor.getJSON().content![0].content!
    expect(content.every((node) => node.marks?.some((value) => value.type === mark))).toBe(true)
    if (mark === "inlineStyle") expect(content[0].marks?.[0].attrs?.color).toBe("#123456")
  })

  it("toggles a format at an empty source caret without creating a divider", async () => {
    const editor = createEditor("<p>当前</p>")
    const source = await enter(editor, "当前")
    input(source, "")
    source.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ctrlKey: true, bubbles: true, cancelable: true }))
    expect(source.value).toBe("")
    expect(editor.view.dom.querySelector("hr")).toBeNull()
    input(source, "新字")
    source.blur()
    expect(editor.view.dom.querySelector("strong")?.textContent).toBe("新字")
  })

  it("respects explicitly disabled formatting inside an existing marked run", async () => {
    const editor = createEditor("<p><strong>当前</strong></p>")
    editor.commands.setTextSelection(2)
    editor.commands.unsetBold()
    editor.view.someProp("handleTextInput", (handler) => handler(editor.view, 2, 2, "新", () => editor.state.tr.insertText("新", 2)))
    await Promise.resolve()
    const source = editor.view.dom.querySelector<HTMLTextAreaElement>("textarea")!
    source.setRangeText("字", source.selectionStart, source.selectionEnd, "end")
    source.dispatchEvent(new Event("input", { bubbles: true }))
    source.blur()
    const content = editor.getJSON().content![0].content!
    expect(editor.state.doc.textContent).toBe("当新字前")
    expect(content.find((node) => "text" in node && node.text === "新字")?.marks).toBeUndefined()
  })

  it("keeps code indentation unchanged while editing other characters", async () => {
    const editor = createEditor("<pre><code>- root\n    - child\n\t- tabbed</code></pre>")
    const source = await enter(editor, "root")
    input(source, source.value.replace("root", "root2"))
    source.blur()
    expect(editor.state.doc.firstChild?.textContent).toBe("- root2\n    - child\n\t- tabbed")
  })

  it("does not inherit unsupported local styles when converting a paragraph to a code block", async () => {
    const InlineStyle = Mark.create({ name: "inlineStyle",
      addAttributes: () => ({ color: { default: null, parseHTML: (element: HTMLElement) => element.style.color } }),
      parseHTML: () => [{ tag: "span[data-td-inline-style]" }], renderHTML: () => ["span", 0],
    })
    const editor = createEditor('<p><span data-td-inline-style style="color: #123456">当前</span></p>', [InlineStyle])
    const source = await enter(editor, "当前")
    input(source, "```text\n当前\n```")
    source.blur()
    expect(editor.state.doc.firstChild?.type.name).toBe("codeBlock")
    expect(editor.state.doc.firstChild?.textContent).toBe("当前")
    expect(editor.state.doc.firstChild?.firstChild?.marks).toEqual([])
    expect(() => editor.state.doc.check()).not.toThrow()
  })
})
