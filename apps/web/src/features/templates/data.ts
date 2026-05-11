import type {
  ResumeTemplateDefinition,
  TemplateSampleContent,
  TemplateStyleConfig,
} from "./types"

export const templateRegistry: ResumeTemplateDefinition[] = [
  {
    id: "classic-a4",
    name: "Classic A4",
    localizedName: { "zh-CN": "经典 A4", "en-US": "Classic A4" },
    description: {
      "zh-CN": "适合通用投递的单栏 A4 简历模板。",
      "en-US": "A single-column A4 resume template for general applications.",
    },
    languages: ["zh-CN", "en-US"],
    status: "built-in",
    tags: {
      "zh-CN": ["内置", "中英双语", "ATS 友好"],
      "en-US": ["Built-in", "Bilingual", "ATS friendly"],
    },
    sampleContentIds: { "zh-CN": "sample-tech-zh", "en-US": "sample-tech-en" },
    configSummary: {
      pageSize: "A4",
      margin: "18mm 20mm",
      fontStack: "Noto Sans SC / Microsoft YaHei / Arial",
      accentColor: "#174ea6",
      layout: "single-column",
    },
    implementation: {
      packageName: "@typedance/resume-renderer",
      rendererEntry: "packages/resume-renderer/src/index.ts",
      templateId: "classic-a4",
    },
    futureConfig: {
      "zh-CN": ["字体", "主色", "页边距", "标题样式", "段落间距"],
      "en-US": ["Font", "Accent color", "Margins", "Heading style", "Paragraph spacing"],
    },
  },
]

export const builtInSamples: Record<string, TemplateSampleContent> = {
  "sample-tech-zh": {
    id: "sample-tech-zh",
    name: { "zh-CN": "通用技术岗样张", "en-US": "General technical sample" },
    target_language: "zh-CN",
    doc_json: {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "张三" }] },
        {
          type: "paragraph",
          content: [{ type: "text", text: "全栈工程师 | React / TypeScript / 本地优先应用" }],
        },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "项目经历" }] },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "负责简历工作台从编辑到 PDF 导出的闭环体验。" }],
                },
              ],
            },
          ],
        },
      ],
    },
    plain_text_snapshot:
      "张三\n全栈工程师 | React / TypeScript / 本地优先应用\n项目经历\n负责简历工作台从编辑到 PDF 导出的闭环体验。",
    updated_at: "2026-05-11T00:00:00.000Z",
  },
  "sample-tech-en": {
    id: "sample-tech-en",
    name: { "zh-CN": "通用技术岗英文样张", "en-US": "General technical sample" },
    target_language: "en-US",
    doc_json: {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Alex Chen" }] },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Full-stack Engineer | React / TypeScript / Local-first Apps",
            },
          ],
        },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Experience" }] },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: "Built an end-to-end resume workspace from editing to PDF export.",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    plain_text_snapshot:
      "Alex Chen\nFull-stack Engineer | React / TypeScript / Local-first Apps\nExperience\nBuilt an end-to-end resume workspace from editing to PDF export.",
    updated_at: "2026-05-11T00:00:00.000Z",
  },
}

export const defaultClassicA4Style: TemplateStyleConfig = {
  template_id: "classic-a4",
  preset: "classic",
  blocks: {
    heading1: { fontSize: "24pt", fontWeight: 700, color: "#1a1a1a", textAlign: "center", marginBottom: "8pt" },
    heading2: { fontSize: "14pt", fontWeight: 600, color: "#1e3a8a", marginBottom: "8pt", borderBottom: { style: "solid", width: "1.5pt", color: "#1e3a8a" } },
    heading3: { fontSize: "11pt", fontWeight: 600, color: "#1f2937", marginBottom: "4pt" },
    paragraph: { fontSize: "10pt", lineHeight: 1.5, color: "#334155", marginBottom: "4pt" },
    bulletList: { fontSize: "10pt", lineHeight: 1.4, color: "#334155", listStyleType: "disc", paddingLeft: "20pt" },
    orderedList: { fontSize: "10pt", lineHeight: 1.4, color: "#334155", listStyleType: "decimal", paddingLeft: "20pt" },
  },
  updated_at: "2026-05-11T00:00:00.000Z",
}

