export type ResumeDocJson = {
  type: "doc"
  content?: ResumeNodeJson[]
}

export type ResumeNodeJson = {
  type: string
  text?: string
  content?: ResumeNodeJson[]
  attrs?: Record<string, unknown>
  marks?: Array<Record<string, unknown>>
}

export type MarkdownBlockFallbackType = "heading" | "list" | "paragraph"

export type MarkdownBlockOptions = {
  fallbackType?: MarkdownBlockFallbackType
  attrs?: Record<string, unknown>
}

export function normalizeMarkdownListIndentation(markdown: string): string

export function markdownToResumeDocJson(markdown: string): ResumeDocJson

export function markdownBlockToResumeDocNodes(
  markdown: string,
  options?: MarkdownBlockOptions,
): ResumeNodeJson[]
