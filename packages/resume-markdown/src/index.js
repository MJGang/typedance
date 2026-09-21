import { Markdown, MarkdownManager } from "@tiptap/markdown"
import StarterKit from "@tiptap/starter-kit"

const manager = new MarkdownManager({
  extensions: [StarterKit, Markdown],
})

const EMPTY_DOC = Object.freeze({
  type: "doc",
  content: [{ type: "paragraph" }],
})

const MARKDOWN_LIST_ITEM = /^([ \t]*)(?=(?:[-+*]|\d+[.)])[ \t]+)/
const MARKDOWN_TAB_SIZE = 4
const NORMALIZED_LIST_INDENT_SIZE = 2

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

export function normalizeMarkdownListIndentation(markdown) {
  const source = String(markdown ?? "")
  const newline = source.includes("\r\n") ? "\r\n" : "\n"
  let hasListParent = false
  let nestedIndentColumns = null

  return source.split(/\r?\n/).map((line) => {
    const match = MARKDOWN_LIST_ITEM.exec(line)
    if (!match) {
      if (line.trim() && !/^[ \t]/.test(line)) {
        hasListParent = false
        nestedIndentColumns = null
      }
      return line
    }

    const indent = match[1]
    let columns = 0
    for (const character of indent) {
      columns += character === "\t"
        ? MARKDOWN_TAB_SIZE - (columns % MARKDOWN_TAB_SIZE)
        : 1
    }

    if (columns === 0) {
      hasListParent = true
      nestedIndentColumns = null
      return line
    }

    if (!hasListParent) return line

    nestedIndentColumns ??= columns
    const depth = Math.max(1, Math.round(columns / nestedIndentColumns))
    const normalizedIndent = " ".repeat(depth * NORMALIZED_LIST_INDENT_SIZE)
    return `${normalizedIndent}${line.slice(indent.length)}`
  }).join(newline)
}

function normalizeContent(content) {
  return Array.isArray(content) && content.length > 0 ? content : undefined
}

function stripFallbackListMarker(text) {
  return text.replace(/^\s*(?:[-*+]|[•·])\s+/, "").trim()
}

function mergeAttrs(node, attrs) {
  return {
    ...node,
    attrs: {
      ...(node.attrs ?? {}),
      ...attrs,
    },
  }
}

function paragraphContentFromMarkdown(text) {
  const doc = markdownToResumeDocJson(text)
  const firstNode = doc.content?.[0]
  if (!firstNode || !Array.isArray(firstNode.content)) {
    return [{ type: "text", text }]
  }
  return cloneJson(firstNode.content)
}

function fallbackNode(node, fallbackType, sourceText) {
  if (fallbackType === "heading" && node.type === "paragraph") {
    return {
      ...node,
      type: "heading",
      attrs: {
        ...(node.attrs ?? {}),
        level: 2,
      },
    }
  }

  if (fallbackType === "list" && node.type === "paragraph") {
    return {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: paragraphContentFromMarkdown(stripFallbackListMarker(sourceText)),
            },
          ],
        },
      ],
    }
  }

  return node
}

function applySourceAttrs(node, attrs) {
  if (!attrs || Object.keys(attrs).length === 0) {
    return node
  }

  if (node.type === "bulletList" || node.type === "orderedList") {
    const content = Array.isArray(node.content) ? [...node.content] : []
    const firstItem = content[0]
    if (firstItem) {
      content[0] = mergeAttrs(firstItem, attrs)
    }
    return { ...node, content }
  }

  return mergeAttrs(node, attrs)
}

export function markdownToResumeDocJson(markdown) {
  const doc = manager.parse(normalizeMarkdownListIndentation(markdown))
  if (!Array.isArray(doc.content) || doc.content.length === 0) {
    return cloneJson(EMPTY_DOC)
  }
  return doc
}

export function markdownBlockToResumeDocNodes(markdown, options = {}) {
  const sourceText = String(markdown ?? "")
  const doc = markdownToResumeDocJson(sourceText)
  const fallbackType = options.fallbackType ?? "paragraph"
  const nodes = normalizeContent(doc.content) ?? [{ type: "paragraph" }]

  return nodes.map((node, index) => {
    const normalizedNode = fallbackNode(cloneJson(node), fallbackType, sourceText)
    return index === 0 ? applySourceAttrs(normalizedNode, options.attrs ?? {}) : normalizedNode
  })
}
