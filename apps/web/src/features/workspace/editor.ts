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
  const root = isResumeNode(doc) ? doc : undefined

  if (!root?.content?.length) {
    return ""
  }

  return root.content
    .map((node) => collectNodeText(node).trim())
    .filter(Boolean)
    .join("\n\n")
}

function collectNodeText(node: ResumeNodeJson): string {
  if (typeof node.text === "string") {
    return node.text
  }

  if (!Array.isArray(node.content)) {
    return ""
  }

  return node.content.map(collectNodeText).join(node.type === "paragraph" ? "" : "\n")
}

function isResumeNode(value: unknown): value is ResumeDocJson {
  return Boolean(value && typeof value === "object" && "type" in value)
}
