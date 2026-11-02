import { Extension, InputRule, markInputRule, type Editor, type JSONContent, type MarkdownToken } from "@tiptap/core"
import type { MarkType } from "@tiptap/pm/model"
import { Plugin } from "@tiptap/pm/state"
import StarterKit from "@tiptap/starter-kit"
import { normalizeMarkdownListIndentation } from "@typedance/resume-markdown"

const INLINE_MARKS: Record<string, string> = { strong: "bold", em: "italic", del: "strike", codespan: "code", link: "link" }
const MARKDOWN_TOKENS = new Set([...Object.keys(INLINE_MARKS), "heading", "list", "blockquote", "code", "hr"])

function hasMarkdownFormatting(tokens: MarkdownToken[]): boolean {
  return tokens.some((token) => (token.type && MARKDOWN_TOKENS.has(token.type)) || (token.tokens && hasMarkdownFormatting(token.tokens)))
}

/** 未安装图片节点时保留图片 Markdown 原文；代码中的相同字符仍保持字面含义。 */
export function parseEditorMarkdown(editor: Editor, source: string): JSONContent {
  const markdown = editor.markdown!
  const normalized = normalizeMarkdownListIndentation(source)
  const literals = new Map<string, string>()
  const rewrite = (raw: string, tokens: MarkdownToken[]): string => {
    let result = "", cursor = 0
    for (const token of tokens) {
      if (!token.raw) continue
      const position = raw.indexOf(token.raw, cursor)
      if (position < 0) continue
      const children = token.tokens ?? token.items ?? []
      let value: string
      if (token.type === "image" && !editor.schema.nodes.image) {
        value = `TDMARKDOWNLITERAL${crypto.randomUUID().replace(/-/g, "")}`
        literals.set(value, token.raw)
      } else value = rewrite(token.raw, children)
      result += raw.slice(cursor, position) + value
      cursor = position + token.raw.length
    }
    return result + raw.slice(cursor)
  }
  const parsed = markdown.parse(rewrite(normalized, markdown.instance.lexer(normalized)))
  const restore = (nodes: JSONContent[]): JSONContent[] => nodes.flatMap((node) => {
    if (node.content) node.content = restore(node.content)
    if (node.type !== "text" || !node.text) return [node]
    let pieces = [node]
    for (const [key, raw] of literals) pieces = pieces.flatMap((piece) => {
      const segments = piece.text!.split(key)
      return segments.flatMap((text, index) => [
        ...(index ? [{ ...piece, text: raw }] : []), ...(text ? [{ ...piece, text }] : []),
      ])
    })
    return pieces
  })
  if (parsed.content) parsed.content = restore(parsed.content)
  const normalize = (node: JSONContent) => {
    node.content?.forEach(normalize)
    // Markdown 允许列表项从标题或代码块开始，原生 listItem schema 要求首块是段落。
    if (node.type === "listItem" && node.content?.[0]?.type !== "paragraph") {
      node.content = [{ type: "paragraph" }, ...node.content ?? []]
    }
  }
  normalize(parsed)
  return parsed
}

function markdownMarkInputRule(editor: Editor, type: MarkType): InputRule {
  const rule = markInputRule({
    type,
    find(text) {
      if (!/[*_~`)]$/.test(text)) return null
      const markdown = editor.markdown
      if (!markdown) return null
      const tokens = markdown.instance.Lexer.lexInline(text)
      const token = tokens[tokens.length - 1]
      if (!token || INLINE_MARKS[token.type] !== type.name || !("text" in token)) return null
      const index = text.length - token.raw.length
      // 等待 ** / *** 等完整结束符，避免在只输入第一个结尾 * 时误转为斜体。
      if (index > 0 && /^[*_~`]/.test(token.raw) && text[index - 1] === token.raw[0]) return null
      const content = markdown.parse(token.raw).content?.[0]?.content
      const singleText = content?.length === 1 && content[0].type === "text" ? content[0] : undefined
      const capture = singleText?.text ?? token.text
      if (!capture || !token.raw.includes(capture)) return null
      const attributes = token.type === "link" ? { href: token.href, title: token.title || null } : {}
      return { index, text: token.raw, replaceWith: capture, data: { attributes, marks: singleText?.marks ?? [] } }
    },
    getAttributes(match) {
      const attributes = match.data?.attributes ?? {}
      return type.name !== "link" || editor.can().setLink(attributes) ? attributes : false
    },
  })
  return new InputRule({
    find: rule.find,
    handler(props) {
      if (rule.handler(props) === null) return null
      // ***文字*** 等组合格式由同一个 Markdown 解析器决定，保留原有文字与其他标记。
      for (const mark of props.match.data?.marks ?? []) {
        const markType = editor.schema.marks[mark.type]
        if (markType) props.state.tr.addMark(props.range.from, props.range.from + props.match[1].length, markType.create(mark.attrs))
      }
    },
  })
}

/** 保留原生块级快捷规则；行内键入与粘贴统一使用当前编辑器的 Markdown 语法。 */
export const MarkdownStarterKit = StarterKit.extend({
  addExtensions() {
    return (this.parent?.() ?? []).map((extension) => {
      if (extension.type !== "mark" || !Object.values(INLINE_MARKS).includes(extension.name)) return extension
      return extension.extend({
        addInputRules() { return [markdownMarkInputRule(this.editor, this.editor.schema.marks[this.name])] },
        addPasteRules() { return [] },
      })
    })
  },
})

export const MarkdownPaste = Extension.create({
  name: "markdownPaste",
  addProseMirrorPlugins() {
    const { editor } = this
    return [new Plugin({
      props: {
        handlePaste(view, event) {
          if (view.state.selection.$from.parent.type.spec.code || editor.isActive("code")) return false
          const text = event.clipboardData?.getData("text/plain")
          const markdown = editor.markdown
          if (!text || !markdown || !hasMarkdownFormatting(markdown.instance.lexer(text))) return false
          return editor.commands.insertContent(parseEditorMarkdown(editor, text))
        },
      },
    })]
  },
})
