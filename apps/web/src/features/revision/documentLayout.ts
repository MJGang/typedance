import { Extension } from "@tiptap/core"
import { templateStyleConfigSchema, type TemplateStyleConfig } from "@typedance/contracts"
import { DEFAULT_SOURCE_CANVAS_PAGE_MARGINS, clampPageMargins, SOURCE_CANVAS_PAGE_SIZE, type PageMargins } from "./pageMargins"

export const DocumentLayout = Extension.create({
  name: "documentLayout",
  addGlobalAttributes() {
    return [{ types: ["doc"], attributes: {
      pageMargins: { default: DEFAULT_SOURCE_CANVAS_PAGE_MARGINS, rendered: false },
      templateStyle: { default: null, rendered: false },
    } }]
  },
})

export function documentMargins(doc: { attrs?: Record<string, unknown> }): PageMargins {
  const margins = doc.attrs?.pageMargins
  if (!margins || typeof margins !== "object") return DEFAULT_SOURCE_CANVAS_PAGE_MARGINS
  return clampPageMargins(margins as PageMargins, SOURCE_CANVAS_PAGE_SIZE)
}

export function documentTemplateStyle(doc: { attrs?: Record<string, unknown> }, base: TemplateStyleConfig): TemplateStyleConfig {
  const parsed = templateStyleConfigSchema.safeParse(doc.attrs?.templateStyle)
  // 文档级覆盖继承所选模板；更换基础模板后不继承上一模板的局部覆盖。
  return parsed.success && parsed.data.template_id === base.template_id ? parsed.data : base
}

export function sameTemplateStyle(left: TemplateStyleConfig, right: TemplateStyleConfig): boolean {
  // 跨进程 JSON 字段顺序不同不代表模板改变；按契约规范化后比较实际值。
  return JSON.stringify(templateStyleConfigSchema.parse(left)) === JSON.stringify(templateStyleConfigSchema.parse(right))
}
