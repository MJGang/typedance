export type ResumeDocJson = {
  type: "doc"
  content?: ResumeNodeJson[]
}

type ResumeNodeJson = {
  type: string
  text?: string
  content?: ResumeNodeJson[]
  attrs?: Record<string, unknown>
  marks?: Array<Record<string, unknown>>
}

export type ResumeEditorChange = {
  plainText: string
  docJson: ResumeDocJson
}

export function looksLikeMarkdown(text: string): boolean {
  const normalized = text.replace(/\r\n?/g, "\n").trim()

  if (!normalized) {
    return false
  }

  const markdownSignals = [
    /^#{1,6}\s+\S/m,
    /^[-*+]\s+\S/m,
    /^\d+\.\s+\S/m,
    /\*\*[^*\n][\s\S]*?[^*\n]\*\*/,
    /_[^_\n][\s\S]*?[^_\n]_/,
    /\[[^\]\n]+\]\([^)]+\)/,
    /^>\s+\S/m,
    /^```/m,
    /^\|.+\|$/m,
  ]

  return markdownSignals.some((pattern) => pattern.test(normalized))
}

export function makeResumeDocFromText(text: string): ResumeDocJson {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length === 0) {
    return {
      type: "doc",
      content: [{ type: "paragraph" }],
    }
  }

  return {
    type: "doc",
    content: lines.map((line) => ({
      type: "paragraph",
      content: [{ type: "text", text: line }],
    })),
  }
}

export function resumeDocToPlainText(doc: ResumeDocJson | Record<string, unknown>): string {
  const root = isResumeDoc(doc) ? doc : undefined

  if (!root?.content?.length) {
    return ""
  }

  return root.content
    .map((node) => collectNodeText(node).trim())
    .filter(Boolean)
    .join("\n\n")
}

function collectNodeText(node: unknown): string {
  if (!isResumeNode(node)) {
    return ""
  }

  if (typeof node.text === "string") {
    return node.text
  }

  if (!Array.isArray(node.content)) {
    return ""
  }

  return node.content.map(collectNodeText).join(node.type === "paragraph" ? "" : "\n")
}

function isResumeDoc(value: unknown): value is ResumeDocJson {
  return (
    isResumeNode(value) &&
    value.type === "doc" &&
    (value.content === undefined || Array.isArray(value.content))
  )
}

function isResumeNode(value: unknown): value is ResumeNodeJson {
  return Boolean(
    value &&
      typeof value === "object" &&
      "type" in value &&
      typeof value.type === "string",
  )
}
