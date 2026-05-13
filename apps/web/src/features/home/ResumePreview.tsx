import { useMemo } from "react"
import { generateFullCSS } from "../templates/style-engine/css-generator"
import type { TemplateStyleConfig } from "@typedance/contracts"

type ResumePreviewProps = {
  docJson: Record<string, unknown>
  styleConfig: TemplateStyleConfig
}

type ResumeNode = {
  type?: string
  text?: string
  attrs?: { level?: number }
  marks?: { type?: string }[]
  content?: ResumeNode[]
}

function nodeBlockType(node: ResumeNode): string {
  if (node.type === "heading") {
    const level = node.attrs?.level ?? 2
    if (level >= 1 && level <= 3) return `heading${level}`
    return "paragraph"
  }
  if (node.type === "bulletList") return "bulletList"
  if (node.type === "orderedList") return "orderedList"
  return "paragraph"
}

function collectText(node: ResumeNode): string {
  if (typeof node.text === "string") return node.text
  return (node.content ?? []).map(collectText).filter(Boolean).join("")
}

function renderNode(node: ResumeNode, key: string) {
  const text = collectText(node)
  const blockClass = `td-resume-${nodeBlockType(node)}`

  if (node.type === "heading") {
    const level = node.attrs?.level ?? 2
    const Tag = level === 1 ? "h3" : level === 2 ? "h4" : "h5"
    return <Tag key={key} className={blockClass}>{text}</Tag>
  }

  if (node.type === "bulletList" || node.type === "orderedList") {
    const Tag = node.type === "bulletList" ? "ul" : "ol"
    return (
      <Tag key={key} className={blockClass}>
        {(node.content ?? []).map((item, index) => (
          <li key={`${key}-${index}`}>{collectText(item)}</li>
        ))}
      </Tag>
    )
  }

  return <p key={key} className={blockClass}>{text}</p>
}

export function ResumePreview({ docJson, styleConfig }: ResumePreviewProps) {
  const cssText = useMemo(() => generateFullCSS(styleConfig.blocks ?? {}), [styleConfig])
  const content = Array.isArray((docJson as { content?: unknown[] })?.content)
    ? (docJson as { content: ResumeNode[] }).content
    : []

  return (
    <>
      <style>{cssText}</style>
      <div className="td-resume-preview-inner">
        {content.length > 0 ? (
          content.map((node, index) => renderNode(node, `resume-${index}`))
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            暂无内容
          </div>
        )}
      </div>
    </>
  )
}
