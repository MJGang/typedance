import type { Heading2DecorationStyle, ResumeVersion, TemplateStyleConfig } from "@typedance/contracts";
import {
  generateTemplateCSS,
  HEADING_CONTENT_CLASS,
  HEADING_PREFIX_CLASS,
  HEADING_SUFFIX_CLASS,
} from "./template-style"

export {
  generateTemplateCSS,
  generateWorkspaceTemplateCSS,
  HEADING_CONTENT_CLASS,
  HEADING_PREFIX_CLASS,
  HEADING_SUFFIX_CLASS,
  mixHexWithWhite,
} from "./template-style"

type TipTapNode = {
  type: string
  text?: string
  content?: TipTapNode[]
  attrs?: Record<string, unknown>
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>
}

type ColumnsAttrs = {
  count: 2 | 3 | 4 | 5 | 6
  gap: "default" | "compact" | "wide"
  widths: number[]
}

const MIN_COLUMN_WIDTH_PERCENT = 15

function equalColumnWidths(count: ColumnsAttrs["count"]) {
  const width = Math.floor((100 / count) * 10_000) / 10_000
  return Array.from({ length: count }, (_, index) => (
    index === count - 1 ? Number((100 - width * (count - 1)).toFixed(4)) : width
  ))
}

function normalizeColumnWidths(value: unknown, count: ColumnsAttrs["count"]) {
  if (!Array.isArray(value) || value.length !== count) return equalColumnWidths(count)

  const rawWidths = value.map(Number)
  if (rawWidths.some((width) => !Number.isFinite(width) || width <= 0)) return equalColumnWidths(count)

  const total = rawWidths.reduce((sum, width) => sum + width, 0)
  const widths = rawWidths.map((width) => Number((width / total * 100).toFixed(4)))
  widths[count - 1] = Number((100 - widths.slice(0, -1).reduce((sum, width) => sum + width, 0)).toFixed(4))
  return widths.some((width) => width < MIN_COLUMN_WIDTH_PERCENT) ? equalColumnWidths(count) : widths
}

function columnGridTemplate(widths: number[]) {
  return widths.map((width) => `minmax(0, ${width}fr)`).join(" ")
}

function columnsHtmlAttributes({ count, gap, widths }: ColumnsAttrs) {
  const serializedWidths = widths.join(",")
  const style = `grid-template-columns: ${columnGridTemplate(widths)}`
  return `data-count="${count}" data-gap="${escapeHtml(gap)}" data-widths="${serializedWidths}" style="${style}"`
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

function inlineStyleToCss(attrs: Record<string, unknown> | undefined): string {
  const rules: string[] = []
  if (typeof attrs?.fontSize === "string" && attrs.fontSize.endsWith("px")) {
    rules.push(`font-size: ${attrs.fontSize}`)
  }
  if (typeof attrs?.color === "string" && /^#[0-9a-fA-F]{6}$/.test(attrs.color)) {
    rules.push(`color: ${attrs.color}`)
  }
  if (typeof attrs?.backgroundColor === "string" && /^#[0-9a-fA-F]{6}$/.test(attrs.backgroundColor)) {
    rules.push(`background-color: ${attrs.backgroundColor}`)
  }
  return rules.join("; ")
}

function blockAttrsToCss(attrs: Record<string, unknown> | undefined): string {
  const rules: string[] = []
  if (attrs?.textAlign === "left" || attrs?.textAlign === "center" || attrs?.textAlign === "right" || attrs?.textAlign === "justify") {
    rules.push(`text-align: ${attrs.textAlign}`)
  }
  if (typeof attrs?.lineHeight === "string" && attrs.lineHeight !== "default") {
    rules.push(`line-height: ${attrs.lineHeight}`)
  }
  if (typeof attrs?.indent === "number" && attrs.indent > 0) {
    rules.push(`margin-left: ${attrs.indent * 1.5}em`)
  }
  return rules.join("; ")
}

function listAttrsToCss(attrs: Record<string, unknown> | undefined): string {
  if (attrs?.listStyleType === "dash") return "list-style-type: '-  '"
  if (attrs?.listStyleType === "circle") return "list-style-type: circle"
  if (attrs?.listStyleType === "lower-alpha") return "list-style-type: lower-alpha"
  if (attrs?.listStyleType === "decimal-nested") return "list-style-type: decimal"
  return ""
}

function styleAttribute(style: string): string {
  return style ? ` style="${escapeHtml(style)}"` : ""
}

function getColumnsAttrs(node: TipTapNode): ColumnsAttrs {
  const rawCount = node.attrs?.count
  const rawGap = node.attrs?.gap
  const count = rawCount === 2 || rawCount === 3 || rawCount === 4 || rawCount === 5 || rawCount === 6 ? rawCount : 2
  const gap = rawGap === "compact" || rawGap === "wide" ? rawGap : "default"
  const widths = normalizeColumnWidths(node.attrs?.widths, count)
  return { count, gap, widths }
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

      if (mark.type === "underline") {
        text = `<u>${text}</u>`
      }

      if (mark.type === "inlineStyle") {
        const style = inlineStyleToCss(mark.attrs)
        if (style) {
          text = `<span data-td-inline-style style="${escapeHtml(style)}">${text}</span>`
        }
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

  if (node.type === "columns") {
    const columnsAttrs = getColumnsAttrs(node)
    const columns = (node.content ?? []).map(renderBlock).filter(Boolean).join("\n      ")
    return columns ? `<div class="td-columns" ${columnsHtmlAttributes(columnsAttrs)}>\n      ${columns}\n    </div>` : ""
  }

  if (node.type === "column") {
    const columnContent = (node.content ?? []).map(renderBlock).filter(Boolean).join("\n      ")
    return `<div class="td-column">\n      ${columnContent}\n    </div>`
  }

  if (node.type === "horizontalRule") {
    return '<hr class="td-resume-divider">'
  }

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
  const layoutStyles = layoutCSS

  return `<!doctype html>\n<html lang="${escapeHtml(resume.target_language)}">\n  <head>\n    <meta charset="utf-8" />\n    <style>\n      @page { size: A4; margin: 20mm 22mm; }\n      body {\n        font-family: "Noto Sans SC", "Microsoft YaHei", Arial, sans-serif;\n        color: #1f2937;\n        line-height: 1.6;\n        font-size: 11px;\n      }\n      .resume-header {\n        border-bottom: 2px solid #174ea6;\n        margin-bottom: 16px;\n        padding-bottom: 12px;\n      }\n      h1 {\n        font-size: 22px;\n        margin: 0 0 4px;\n        font-weight: 700;\n        color: #101827;\n      }\n      .resume-title {\n        font-size: 11px;\n        margin: 0;\n        color: #174ea6;\n        font-weight: 600;\n      }\n      .resume-body p {\n        margin: 0 0 8px;\n        font-size: 10px;\n        line-height: 1.55;\n        color: #374151;\n      }\n      .muted { color: #9ca3af; font-style: italic; }\n${layoutStyles}\n    </style>\n  </head>\n  <body>\n    ${body}\n  </body>\n</html>`
}

// ---------------------------------------------------------------------------
// renderStyledHtml 鈥?complete HTML document with td-resume-* CSS classes
// and inline BlockStyle CSS rules
// ---------------------------------------------------------------------------

function getBlockName(node: TipTapNode): string {
  if (node.type === "heading") {
    const rawLevel = node.attrs?.level
    const level = typeof rawLevel === "number" && rawLevel >= 1 && rawLevel <= 3 ? rawLevel : 2
    return `heading${level}`
  }
  return node.type
}

const layoutCSS = `body.td-resume-page,
body.td-resume-page * {
  box-sizing: border-box;
}
.td-columns {
  display: grid;
  align-items: stretch;
  gap: 10px;
  margin: 0 0 8px;
}
:where(.td-resume-page h1, .td-resume-page h2, .td-resume-page h3, .td-resume-page p, .td-resume-page ul, .td-resume-page ol) {
  margin: 0;
}
:where(.td-resume-page ul, .td-resume-page ol) {
  padding-left: 0;
}
.td-resume-page li > ol,
.td-resume-page li > ul {
  break-inside: avoid;
}
.td-columns[data-count="2"] {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.td-columns[data-count="3"] {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.td-columns[data-count="4"] {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.td-columns[data-count="5"] {
  grid-template-columns: repeat(5, minmax(0, 1fr));
}
.td-columns[data-count="6"] {
  grid-template-columns: repeat(6, minmax(0, 1fr));
}
.td-columns[data-gap="compact"] {
  gap: 6px;
}
.td-columns[data-gap="wide"] {
  gap: 16px;
}
.td-column {
  min-width: 0;
  min-height: 24px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding-block: 3px;
}
.td-columns .td-column > :last-child {
  margin-bottom: 0;
}
.td-resume-divider {
  border: 0;
  border-top: 1px solid #d1d5db;
  margin: 8px 0;
}`

// Extract heading number (1-3) from a block name like "heading1", "heading2", "heading3"
function headingNumber(blockName: string): number {
  return blockName === "heading3" ? 3 : blockName === "heading2" ? 2 : 1
}

function renderStyledBlock(
  node: TipTapNode,
  heading2Style: Heading2DecorationStyle,
  parentBlockName?: string,
): string {
  const blockName = getBlockName(node)

  if (node.type === "columns") {
    const columnsAttrs = getColumnsAttrs(node)
    const columns = (node.content ?? []).map((child) => renderStyledBlock(child, heading2Style)).filter(Boolean).join("\n      ")
    return columns ? `<div class="td-columns" ${columnsHtmlAttributes(columnsAttrs)}>\n      ${columns}\n    </div>` : ""
  }

  if (node.type === "column") {
    const columnContent = (node.content ?? []).map((child) => renderStyledBlock(child, heading2Style)).filter(Boolean).join("\n      ")
    return `<div class="td-column">\n      ${columnContent}\n    </div>`
  }

  if (node.type === "horizontalRule") {
    return '<hr class="td-resume-divider">'
  }

  if (node.type === "heading") {
    const content = (node.content ?? []).map(renderInlineContent).join("")
    const level = headingNumber(blockName)
    const style = blockAttrsToCss(node.attrs)
    if (level === 2) {
      return `<h2 class="td-resume-heading2" data-heading-style="${heading2Style}"${styleAttribute(style)}>`
        + `<span class="${HEADING_PREFIX_CLASS}" aria-hidden="true"></span>`
        + `<span class="${HEADING_CONTENT_CLASS}">${content}</span>`
        + `<span class="${HEADING_SUFFIX_CLASS}" aria-hidden="true"></span>`
        + "</h2>"
    }
    return `<h${level} class="td-resume-${blockName}"${styleAttribute(style)}>${content}</h${level}>`
  }

  if (node.type === "paragraph") {
    const content = (node.content ?? []).map(renderInlineContent).join("")
    const style = blockAttrsToCss(node.attrs)
    return content ? `<p class="td-resume-paragraph"${styleAttribute(style)}>${content}</p>` : ""
  }

  if (node.type === "bulletList" || node.type === "orderedList") {
    const tag = node.type === "orderedList" ? "ol" : "ul"
    const style = listAttrsToCss(node.attrs)
    const items = (node.content ?? [])
      .map((child) => renderStyledBlock(child, heading2Style, blockName))
      .filter(Boolean)
      .join("\n      ")
    return items ? `<${tag} class="td-resume-${blockName}"${styleAttribute(style)}>\n      ${items}\n    </${tag}>` : ""
  }

  if (node.type === "listItem") {
    const itemContent = (node.content ?? [])
      .map((child) => {
        if (child.type === "paragraph") {
          const content = renderInlineContent(child)
          const textClass = parentBlockName ? ` td-resume-${parentBlockName}Text` : ""
          const style = blockAttrsToCss(child.attrs)
          return content ? `<p class="td-resume-paragraph${textClass}"${styleAttribute(style)}>${content}</p>` : ""
        }
        return renderStyledBlock(child, heading2Style)
      })
      .filter(Boolean)
      .join("\n        ")
    return itemContent ? `<li>\n        ${itemContent}\n      </li>` : ""
  }

  // Fallback for unknown node types
  const content = (node.content ?? []).map(renderInlineContent).join("")
  return content ? `<p class="td-resume-paragraph">${content}</p>` : ""
}

export function renderStyledContentHtml(docJson: unknown, config: TemplateStyleConfig): string {
  if (!isTipTapNode(docJson) || !Array.isArray(docJson.content)) {
    return ""
  }
  const body = docJson.content
    .map((node) => renderStyledBlock(node, config.blocks.heading2.decorationStyle))
    .filter(Boolean)
    .join("\n    ")
  return body || ""
}

export function renderStyledHtml(
  docJson: unknown,
  config: TemplateStyleConfig,
  lang: string,
): string {
  const body = renderStyledContentHtml(docJson, config)
  const blockCSS = generateTemplateCSS(config)
  const layoutStyles = layoutCSS

  return `<!doctype html>\n<html lang="${escapeHtml(lang)}">\n  <head>\n    <meta charset="utf-8" />\n    <style>\n      @page { size: A4; margin: 20mm 22mm; }\n      body {\n        font-family: "Noto Sans SC", "Microsoft YaHei", Arial, sans-serif;\n        color: #1f2937;\n        line-height: 1.6;\n        font-size: 11px;\n        margin: 0;\n        padding: 0;\n      }\n${blockCSS ? `\n${blockCSS}` : ""}\n${layoutStyles}\n    </style>\n  </head>\n  <body>\n    ${body}\n  </body>\n</html>`
}
