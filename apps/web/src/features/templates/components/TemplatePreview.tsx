import type { TemplateSampleContent, TemplateStyleConfig } from "../types"

type TemplatePreviewProps = {
  sample: TemplateSampleContent
  styleConfig: TemplateStyleConfig
  scale?: "card" | "detail"
}

type TemplateNode = {
  type?: string
  text?: string
  attrs?: { level?: number }
  content?: TemplateNode[]
}

export function TemplatePreview({ sample, styleConfig, scale = "card" }: TemplatePreviewProps) {
  const pageClass = styleConfig.slots.page?.class_name ?? ""
  const headerClass = styleConfig.slots.header?.class_name ?? ""
  const content = Array.isArray(sample.doc_json.content) ? (sample.doc_json.content as TemplateNode[]) : []

  return (
    <div className={`td-template-preview td-template-preview-${scale}`}>
      <article
        className={`td-template-paper ${pageClass}`}
        aria-label="A4 template sample preview"
      >
        {content.map((node, index) => renderNode(node, `${node.type ?? "node"}-${index}`, headerClass))}
      </article>
    </div>
  )
}

function renderNode(node: TemplateNode, key: string, headerClass: string) {
  const text = collectText(node)

  if (node.type === "heading") {
    const level = node.attrs?.level === 1 ? 1 : 2
    if (level === 1) {
      return (
        <h3 key={key} className={headerClass}>
          {text}
        </h3>
      )
    }
    return <h4 key={key}>{text}</h4>
  }

  if (node.type === "bulletList") {
    return (
      <ul key={key}>
        {(node.content ?? []).map((item, index) => (
          <li key={`${key}-${index}`}>{collectText(item)}</li>
        ))}
      </ul>
    )
  }

  return <p key={key}>{text}</p>
}

function collectText(node: TemplateNode): string {
  if (typeof node.text === "string") {
    return node.text
  }

  return (node.content ?? []).map(collectText).filter(Boolean).join(node.type === "paragraph" ? "" : " ")
}
