import { canvasPrintSnapshotSchema, type CanvasPrintSnapshot } from "@typedance/contracts"

const OMIT = "button,script,style,iframe,svg,.td-columns-resize-overlay,.td-columns-controls-overlay,.td-column-resize-handle,.td-column-grip,.td-column-delete,.td-column-add-button,.td-module-interaction-only"
const ATTRIBUTES = new Set(["class", "style", "start", "reversed", "value", "dir", "lang"])
const PROPERTIES = [
  "display", "box-sizing", "position", "top", "right", "bottom", "left", "float", "clear",
  "min-width", "max-width", "min-height", "max-height", "vertical-align", "overflow", "overflow-x", "overflow-y",
  "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding-top", "padding-right", "padding-bottom", "padding-left",
  "border-top", "border-right", "border-bottom", "border-left", "border-radius", "border-collapse", "border-spacing",
  "flex-direction", "flex-wrap", "flex-grow", "flex-shrink", "flex-basis", "align-items", "align-self", "justify-content",
  "grid-template-columns", "grid-template-rows", "grid-column", "grid-row", "row-gap", "column-gap",
  "font-family", "font-size", "font-weight", "font-style", "font-stretch", "font-kerning", "font-feature-settings",
  "font-variation-settings", "font-optical-sizing", "line-height", "letter-spacing", "word-spacing",
  "color", "text-align", "text-indent", "text-transform", "text-decoration", "text-decoration-color",
  "text-decoration-thickness", "text-underline-offset", "white-space", "word-break", "overflow-wrap", "tab-size",
  "list-style-type", "list-style-position", "counter-reset", "counter-increment",
  "background-color", "background-image", "background-size", "background-position", "background-repeat",
  "opacity", "visibility", "z-index", "isolation", "transform", "transform-origin", "direction", "unicode-bidi",
] as const

function clonePrintElement(source: HTMLElement): HTMLElement | null {
  if (source.matches(OMIT)) return null
  const clone = source.cloneNode(false) as HTMLElement
  for (const attribute of Array.from(clone.attributes)) {
    if (!ATTRIBUTES.has(attribute.name)) clone.removeAttribute(attribute.name)
  }
  if (source.tagName === "A") {
    const href = source.getAttribute("href") ?? ""
    if (/^(https?:|mailto:|tel:)/i.test(href)) clone.setAttribute("href", href)
  }
  const computed = getComputedStyle(source)
  for (const property of PROPERTIES) clone.style.setProperty(property, computed.getPropertyValue(property))
  // 保留无单位行高。转成 CSSOM 的 px 字符串会改变子像素舍入，累积后提前换页。
  const lineHeight = source.computedStyleMap().get("line-height")
  if (lineHeight) clone.style.lineHeight = lineHeight.toString()
  // 普通块仍由内容撑高；冻结其计算高度会改变外边距折叠，从而再次改变分页。
  if (computed.position === "absolute") {
    clone.style.width = computed.width
    clone.style.height = computed.height
  } else if (computed.display === "table") {
    // 空段落占满一行，不能缩到分页浮动区域旁边。
    clone.style.width = computed.width
  }
  clone.style.boxShadow = "none"
  clone.style.outline = "none"
  for (const child of source.childNodes) {
    const copy = child instanceof HTMLElement ? clonePrintElement(child) : child.nodeType === Node.TEXT_NODE ? child.cloneNode(true) : null
    if (copy) clone.appendChild(copy)
  }
  return clone
}

export function captureCanvasPrintSnapshot(editor: HTMLElement): CanvasPrintSnapshot {
  const rect = editor.getBoundingClientRect()
  const computed = getComputedStyle(editor)
  const pageWidth = Number.parseFloat(computed.width)
  const pageHeight = Number.parseFloat(computed.getPropertyValue("--rm-page-height"))
  if (!(rect.width > 0 && pageWidth > 0 && pageHeight > 0)) throw new Error("画布尚未完成分页，请稍后再导出")
  const scale = rect.width / pageWidth
  const pageTops = [0, ...Array.from(editor.querySelectorAll<HTMLElement>(".rm-pagination-gap"))
    .map((gap) => gap.getBoundingClientRect())
    .filter((gap) => gap.height > 0)
    .map((gap) => (gap.bottom - rect.top) / scale)]
  const clone = clonePrintElement(editor)
  if (!clone) throw new Error("画布内容不可导出")
  for (const [property, value] of Object.entries({ position: "absolute", left: "0", top: "0", margin: "0" })) {
    clone.style.setProperty(property, value, "important")
  }
  clone.style.borderColor = "transparent"
  return canvasPrintSnapshotSchema.parse({ html: clone.outerHTML, page_width: pageWidth, page_height: pageHeight, page_tops: pageTops })
}

export async function prepareCanvasPrintSnapshot(editor: HTMLElement): Promise<CanvasPrintSnapshot> {
  await document.fonts.ready
  let previous = ""
  let stableFrames = 0
  const startedAt = performance.now()
  while (performance.now() - startedAt < 5000) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    // AI 应用后的短暂高亮是编辑反馈，等它消失后再读取正文背景样式。
    if (editor.closest(".td-ai-canvas-flash") || editor.querySelector(".td-ai-canvas-flash")) {
      stableFrames = 0
      continue
    }
    const signature = `${editor.scrollHeight}:${Array.from(editor.querySelectorAll(".rm-pagination-gap"), (gap) => gap.getBoundingClientRect().bottom).join(",")}`
    stableFrames = signature === previous ? stableFrames + 1 : 0
    if (stableFrames >= 3) return captureCanvasPrintSnapshot(editor)
    previous = signature
  }
  throw new Error("画布分页仍在变化，请稍后再导出")
}
