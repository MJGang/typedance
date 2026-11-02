import { Editor } from "@tiptap/core"
import { Markdown } from "@tiptap/markdown"
import { Slice } from "@tiptap/pm/model"
import { afterEach, describe, expect, it } from "vitest"
import { MarkdownPaste, MarkdownStarterKit } from "./MarkdownEditing"

const editors: Editor[] = []
const example = "**Agent 应用：** 熟悉LangChain、LangGraph 状态机、**意图识别与能力路由**、**Planner-Executor**、**ReAct** 及多轮上下文管理；具备MCP/Tool Calling、Workflow编排、会话状态持久化及中断恢复实践。"

function createEditor(content = "<p></p>") {
  const editor = new Editor({ extensions: [MarkdownStarterKit, Markdown, MarkdownPaste], content,
    editorProps: { handleScrollToSelection: () => true } })
  editors.push(editor)
  return editor
}

/** 逐字走原生 handleTextInput，覆盖真实键入规则，而非绕过输入规则直接设置文档。 */
function typeText(editor: Editor, text: string) {
  for (const character of text) {
    const { from, to } = editor.state.selection
    const handled = editor.view.someProp("handleTextInput", (handler) => handler(editor.view, from, to, character,
      () => editor.state.tr.insertText(character, from, to)))
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(character, from, to))
  }
}

function pasteText(editor: Editor, text: string) {
  const event = { clipboardData: { getData: (type: string) => type === "text/plain" ? text : "" } } as ClipboardEvent
  return editor.view.someProp("handlePaste", (handler) => handler(editor.view, event, Slice.empty))
}

afterEach(() => { editors.splice(0).forEach((editor) => editor.destroy()) })

describe("Markdown typing", () => {
  it.each([
    ["**加粗**", "strong", "加粗"], ["__加粗__", "strong", "加粗"],
    ["*斜体*", "em", "斜体"], ["_斜体_", "em", "斜体"],
    ["~~删除线~~", "s", "删除线"], ["`行内代码`", "code", "行内代码"],
    ["***组合***", "strong em", "组合"], ["[链接](https://example.com)", "a", "链接"],
  ])("converts %s directly after Chinese punctuation", (markdown, selector, text) => {
    const editor = createEditor()
    typeText(editor, `熟悉、${markdown}`)
    expect(editor.view.dom.querySelector(selector)?.textContent).toBe(text)
    expect(editor.getText()).toBe(`熟悉、${text}`)
  })

  it.each(["<p></p>", "<h3></h3>", "<ul><li><p></p></li></ul>", "<ol><li><p></p></li></ol>"])("converts the complete resume example inside %s", (content) => {
    const editor = createEditor(content)
    typeText(editor, example)
    expect([...editor.view.dom.querySelectorAll("strong")].map((node) => node.textContent)).toEqual(["Agent 应用：", "意图识别与能力路由", "Planner-Executor", "ReAct"])
    expect(editor.state.doc.textContent).toBe(example.replace(/\*\*/g, ""))
    if (content.startsWith("<ul>") || content.startsWith("<ol>")) expect(editor.view.dom.querySelector("li strong")?.textContent).toBe("Agent 应用：")
  })

  it("waits for complete delimiters and preserves nested formatting", () => {
    const editor = createEditor()
    typeText(editor, "**加粗*")
    expect(editor.getText()).toBe("**加粗*")
    expect(editor.view.dom.querySelector("em,strong")).toBeNull()
    typeText(editor, "*、**加粗 *斜体* 内容**")
    expect(editor.getText()).toBe("加粗、加粗 斜体 内容")
    expect(editor.view.dom.querySelector("strong em")?.textContent).toBe("斜体")
  })

  it.each(["\\*\\*原样\\*\\*", "agent_state_key", "** 空格 **"])("keeps literal or incomplete input %s", (text) => {
    const editor = createEditor()
    typeText(editor, text)
    expect(editor.getText()).toBe(text)
    expect(editor.view.dom.querySelector("strong,em,s,code,a")).toBeNull()
  })

  it("preserves Markdown literally inside code blocks", () => {
    const editor = createEditor("<pre><code></code></pre>")
    typeText(editor, example)
    expect(editor.state.doc.textContent).toBe(example)
    expect(editor.view.dom.querySelector("strong")).toBeNull()
  })

  it("does not create unsafe Markdown links", () => {
    const editor = createEditor()
    typeText(editor, "[链接](javascript:alert(1))")
    expect(editor.view.dom.querySelector("a")).toBeNull()
  })

  it.each([["### 标题", "h3"], ["> 引用", "blockquote"], ["- 列表", "ul"], ["1. 列表", "ol"], ["``` ", "pre"], ["---", "hr"]])("retains native block shortcut %s", (text, selector) => {
    const editor = createEditor()
    typeText(editor, text)
    expect(editor.view.dom.querySelector(selector)).not.toBeNull()
  })
})

describe("Markdown paste", () => {
  it.each([["**字**", "strong"], ["*字*", "em"], ["~~字~~", "s"], ["`代码`", "code"], ["[链接](https://example.com)", "a"],
    ["### 标题", "h3"], ["> 引用", "blockquote"], ["- 列表", "ul"], ["1) 列表", "ol"], ["~~~js\nconst a = 1\n~~~", "pre"], ["---", "hr"]])("parses %s with the editor Markdown parser", (text, selector) => {
    const editor = createEditor()
    expect(pasteText(editor, text)).toBe(true)
    expect(editor.view.dom.querySelector(selector)).not.toBeNull()
  })

  it("renders every bold segment in the pasted resume example", () => {
    const editor = createEditor()
    expect(pasteText(editor, example)).toBe(true)
    expect(editor.view.dom.querySelectorAll("strong")).toHaveLength(4)
    expect(editor.getText()).toBe(example.replace(/\*\*/g, ""))
  })

  it.each(["普通简历正文", "agent_state_key", "\\*\\*保留原样\\*\\*"])("leaves plain text to native paste: %s", (text) => {
    const editor = createEditor()
    expect(pasteText(editor, text)).toBeFalsy()
    expect(editor.getText()).toBe("")
  })

  it("leaves code-block paste literal", () => {
    const editor = createEditor("<pre><code></code></pre>")
    expect(pasteText(editor, example)).toBeFalsy()
  })
})
