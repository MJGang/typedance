import type { BlockStyle, ResumeVersion } from "@typedance/contracts";

type TipTapNode = {
  type: string
  text?: string
  content?: TipTapNode[]
  attrs?: Record<string, unknown>
  marks?: Array<{ type?: string }>
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function isTipTapNode(value: unknown): value is TipTapNode {
  return Boolean(
    value &&
      typeof value === "object" &&
      "type" in value &&
      typeof (value as { type?: unknown }).type === "string",
  )
}

function renderInlineContent(node: TipTapNode): string {
  if (typeof node.text === "string") {
    let text = escapeHtml(node.text)

    for (const mark of node.marks ?? []) {
      if (mark.type === "bold") {
        text = `<strong>${text}</strong>`
      }

      if (mark.type === "italic") {
        text = `<em>${text}</em>`
      }
    }

    return text
  }

  if (node.type === "hardBreak") {
    return "<br />"
  }

  return (node.content ?? []).map(renderInlineContent).join("")
}

function renderBlock(node: TipTapNode): string {
  const content = (node.content ?? []).map(renderInlineContent).join("")

  if (node.type === "heading") {
    const rawLevel = node.attrs?.level
    const level = typeof rawLevel === "number" && rawLevel >= 1 && rawLevel <= 3 ? rawLevel : 2
    return `<h${level}>${content}</h${level}>`
  }

  if (node.type === "paragraph") {
    return content ? `<p>${content}</p>` : ""
  }

  if (node.type === "bulletList" || node.type === "orderedList") {
    const tag = node.type === "orderedList" ? "ol" : "ul"
    const items = (node.content ?? []).map(renderBlock).filter(Boolean).join("\n      ")
    return items ? `<${tag}>\n      ${items}\n    </${tag}>` : ""
  }

  if (node.type === "listItem") {
    const itemContent = (node.content ?? [])
      .map((child) => {
        if (child.type === "paragraph") {
          return renderInlineContent(child)
        }

        return renderBlock(child)
      })
      .filter(Boolean)
      .join("")
    return itemContent ? `<li>${itemContent}</li>` : ""
  }

  return content ? `<p>${content}</p>` : ""
}

function renderDocJson(docJson: unknown): string | null {
  if (!isTipTapNode(docJson) || !Array.isArray(docJson.content)) {
    return null
  }

  const body = docJson.content.map(renderBlock).filter(Boolean).join("\n    ")
  return body || null
}

function renderSnapshot(snapshot: string): string {
  const lines = snapshot
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return '<p class="muted">Start writing your resume.</p>'
  }

  const name = escapeHtml(lines[0])
  const title = lines.length > 1 ? escapeHtml(lines[1]) : ""
  const experience = lines.slice(2)

  let body = `<header class="resume-header">\n      <h1>${name}</h1>\n      ${title ? `<p class="resume-title">${title}</p>` : ""}\n    </header>`

  if (experience.length > 0) {
    body += "\n    <section class=\"resume-body\">\n      "
    body += experience.map((line) => `<p>${escapeHtml(line)}</p>`).join("\n      ")
    body += "\n    </section>"
  }

  return body
}

export function renderResumeHtml(resume: ResumeVersion): string {
  const body = renderDocJson(resume.doc_json) ?? renderSnapshot(resume.plain_text_snapshot)

  return `<!doctype html>\n<html lang="${escapeHtml(resume.target_language)}">\n  <head>\n    <meta charset="utf-8" />\n    <style>\n      @page { size: A4; margin: 20mm 22mm; }\n      body {\n        font-family: "Noto Sans SC", "Microsoft YaHei", Arial, sans-serif;\n        color: #1f2937;\n        line-height: 1.6;\n        font-size: 11pt;\n      }\n      .resume-header {\n        border-bottom: 2px solid #174ea6;\n        margin-bottom: 16px;\n        padding-bottom: 12px;\n      }\n      h1 {\n        font-size: 22pt;\n        margin: 0 0 4px;\n        font-weight: 700;\n        color: #101827;\n      }\n      .resume-title {\n        font-size: 11pt;\n        margin: 0;\n        color: #174ea6;\n        font-weight: 600;\n      }\n      .resume-body p {\n        margin: 0 0 8px;\n        font-size: 10pt;\n        line-height: 1.55;\n        color: #374151;\n      }\n      .muted { color: #9ca3af; font-style: italic; }\n    </style>\n  </head>\n  <body>\n    ${body}\n  </body>\n</html>`
}

// ---------------------------------------------------------------------------
// renderStyledHtml — complete HTML document with td-resume-* CSS classes
// and inline BlockStyle CSS rules
// ---------------------------------------------------------------------------

const CSS_PROP_MAP: Record<string, string> = {
  fontFamily: "font-family",
  fontSize: "font-size",
  fontWeight: "font-weight",
  lineHeight: "line-height",
  letterSpacing: "letter-spacing",
  textTransform: "text-transform",
  color: "color",
  backgroundColor: "background-color",
  textAlign: "text-align",
  marginTop: "margin-top",
  marginBottom: "margin-bottom",
  listStyleType: "list-style-type",
  paddingLeft: "padding-left",
}

function getBlockName(node: TipTapNode): string {
  if (node.type === "heading") {
    const rawLevel = node.attrs?.level
    const level = typeof rawLevel === "number" && rawLevel >= 1 && rawLevel <= 3 ? rawLevel : 2
    return `heading${level}`
  }
  return node.type
}

function generateBlockCSS(blockName: string, style: BlockStyle): string {
  const rules: string[] = []
  for (const [key, value] of Object.entries(style)) {
    if (key === "borderBottom" && typeof value === "object" && value !== null) {
      const bs = value as { style?: string; width?: string; color?: string }
      if (bs.style && bs.style !== "none") {
        rules.push(`  border-bottom-style: ${bs.style};`)
        if (bs.width) rules.push(`  border-bottom-width: ${bs.width};`)
        if (bs.color) rules.push(`  border-bottom-color: ${bs.color};`)
      }
      continue
    }
    const prop = CSS_PROP_MAP[key]
    if (prop && value !== undefined && value !== null) {
      rules.push(`  ${prop}: ${value};`)
    }
  }
  if (rules.length === 0) return ""
  return `.td-resume-${blockName} {\n${rules.join("\n")}\n}`
}

function generateFullCSS(blocks: Record<string, BlockStyle>): string {
  return Object.entries(blocks)
    .map(([name, style]) => generateBlockCSS(name, style))
    .filter(Boolean)
    .join("\n\n")
}

// Extract heading number (1-3) from a block name like "heading1", "heading2", "heading3"
function headingNumber(blockName: string): number {
  return blockName === "heading3" ? 3 : blockName === "heading2" ? 2 : 1
}

function renderStyledBlock(node: TipTapNode, parentBlockName?: string): string {
  const blockName = getBlockName(node)

  if (node.type === "heading") {
    const content = (node.content ?? []).map(renderInlineContent).join("")
    const level = headingNumber(blockName)
    return `<h${level} class="td-resume-${blockName}">${content}</h${level}>`
  }

  if (node.type === "paragraph") {
    const content = (node.content ?? []).map(renderInlineContent).join("")
    return content ? `<p class="td-resume-paragraph">${content}</p>` : ""
  }

  if (node.type === "bulletList" || node.type === "orderedList") {
    const tag = node.type === "orderedList" ? "ol" : "ul"
    const items = (node.content ?? [])
      .map((child) => renderStyledBlock(child, blockName))
      .filter(Boolean)
      .join("\n      ")
    return items ? `<${tag} class="td-resume-${blockName}">\n      ${items}\n    </${tag}>` : ""
  }

  if (node.type === "listItem") {
    const itemContent = (node.content ?? [])
      .map((child) => {
        if (child.type === "paragraph") {
          return renderInlineContent(child)
        }
        return renderStyledBlock(child)
      })
      .filter(Boolean)
      .join("")
    const liClass = parentBlockName ? `td-resume-${parentBlockName}` : `td-resume-${blockName}`
    return itemContent ? `<li class="${liClass}">${itemContent}</li>` : ""
  }

  // Fallback for unknown node types
  const content = (node.content ?? []).map(renderInlineContent).join("")
  return content ? `<p class="td-resume-paragraph">${content}</p>` : ""
}

function renderStyledDocJson(docJson: unknown): string | null {
  if (!isTipTapNode(docJson) || !Array.isArray(docJson.content)) {
    return null
  }
  const body = docJson.content.map(renderStyledBlock).filter(Boolean).join("\n    ")
  return body || null
}

export function renderStyledHtml(
  docJson: unknown,
  blocks: Record<string, BlockStyle>,
  lang: string,
): string {
  const body = renderStyledDocJson(docJson) ?? ""
  const blockCSS = generateFullCSS(blocks)

  return `<!doctype html>\n<html lang="${escapeHtml(lang)}">\n  <head>\n    <meta charset="utf-8" />\n    <style>\n      @page { size: A4; margin: 20mm 22mm; }\n      body {\n        font-family: "Noto Sans SC", "Microsoft YaHei", Arial, sans-serif;\n        color: #1f2937;\n        line-height: 1.6;\n        font-size: 11pt;\n        margin: 0;\n        padding: 0;\n      }\n${blockCSS ? `\n${blockCSS}` : ""}\n    </style>\n  </head>\n  <body>\n    ${body}\n  </body>\n</html>`
}
