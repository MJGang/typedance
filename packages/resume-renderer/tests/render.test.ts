import { describe, expect, it } from "vitest";
import type { Heading2DecorationStyle, TemplateStyleConfig } from "@typedance/contracts";
import {
  generateTemplateCSS,
  generateWorkspaceTemplateCSS,
  mixHexWithWhite,
  renderResumeHtml,
  renderStyledContentHtml,
  renderStyledHtml,
} from "../src/index";

const sampleDocJson = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Ada Lovelace" }],
    },
    {
      type: "paragraph",
      content: [{ type: "text", text: "Computing pioneer with " }, { type: "text", text: "analytical", marks: [{ type: "bold" }] }, { type: "text", text: " experience." }],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Designed programmable computation notes" }],
            },
          ],
        },
      ],
    },
  ],
};

const sampleBlocks = {
  heading1: {
    fontSize: "18px",
    color: "#1f2937",
    fontWeight: 700 as const,
  },
  heading2: {
    decorationStyle: "minimal-line" as const,
  },
  heading3: {},
  paragraph: {
    fontSize: "10px",
    lineHeight: 1.55,
  },
  bulletList: {
    listStyleType: "disc" as const,
    paddingLeft: "20px",
  },
  orderedList: {},
};

function styleConfig(decorationStyle: Heading2DecorationStyle = "minimal-line"): TemplateStyleConfig {
  return {
    template_id: "classic-a4",
    preset: "classic",
    theme: { accentColor: "#174ea6" },
    blocks: {
      ...sampleBlocks,
      heading2: { ...sampleBlocks.heading2, decorationStyle },
    },
    updated_at: "2026-09-21T00:00:00.000Z",
  };
}

describe("renderResumeHtml", () => {
  it("renders TipTap JSON as the canonical resume content", () => {
    const html = renderResumeHtml({
      id: "resume_json",
      title: "Fallback Title",
      target_language: "en-US",
      template_id: "classic-a4",
      doc_json: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Ada Lovelace" }],
          },
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Computing pioneer with " },
              { type: "text", text: "analytical", marks: [{ type: "bold" }] },
              { type: "text", text: " experience." },
            ],
          },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Designed programmable computation notes" }],
                  },
                ],
              },
            ],
          },
        ],
      },
      plain_text_snapshot: "Stale snapshot that must not render",
      source_refs: [],
      accepted_edit_ids: [],
      created_at: "2026-05-08T08:00:00.000Z",
      updated_at: "2026-05-08T08:00:00.000Z"
    });

    expect(html).toContain("<h1>Ada Lovelace</h1>");
    expect(html).toContain("<strong>analytical</strong>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>Designed programmable computation notes</li>");
    expect(html).not.toContain("Stale snapshot");
  });

  it("renders first line as h1 and escapes special characters", () => {
    const html = renderResumeHtml({
      id: "resume_1",
      title: "A < B",
      target_language: "en-US",
      template_id: "classic-a4",
      doc_json: {},
      plain_text_snapshot: "Built <secure> export",
      source_refs: [],
      accepted_edit_ids: [],
      created_at: "2026-05-08T08:00:00.000Z",
      updated_at: "2026-05-08T08:00:00.000Z"
    });

    // First line of plain_text_snapshot is rendered as h1 (name)
    expect(html).toContain("<h1>Built &lt;secure&gt; export</h1>");
  });

  it("renders multiline snapshot as name, title, and body", () => {
    const html = renderResumeHtml({
      id: "resume_2",
      title: "Resume",
      target_language: "zh-CN",
      template_id: "classic-a4",
      doc_json: {},
      plain_text_snapshot: "张三\n全栈开发\n负责产品设计",
      source_refs: [],
      accepted_edit_ids: [],
      created_at: "2026-05-08T08:00:00.000Z",
      updated_at: "2026-05-08T08:00:00.000Z"
    });

    expect(html).toContain("<h1>张三</h1>");
    expect(html).toContain("class=\"resume-title\"");
    expect(html).toContain("全栈开发");
    expect(html).toContain("class=\"resume-body\"");
    expect(html).toContain("负责产品设计");
  });
});

describe("renderStyledHtml", () => {
  it("preserves custom column widths and vertically centers column content", () => {
    const html = renderStyledHtml({
      type: "doc",
      content: [{
        type: "columns",
        attrs: { count: 2, gap: "default", widths: [65, 35] },
        content: [
          { type: "column", content: [{ type: "paragraph", content: [{ type: "text", text: "Long" }] }] },
          { type: "column", content: [{ type: "paragraph", content: [{ type: "text", text: "Short" }] }] },
        ],
      }],
    }, styleConfig(), "en-US")

    expect(html).toContain('data-widths="65,35"')
    expect(html).toContain('style="grid-template-columns: minmax(0, 65fr) minmax(0, 35fr)"')
    expect(html).toContain("align-items: center;")
  })

  it("outputs a complete HTML document with doctype and html tag", () => {
    const html = renderStyledHtml(sampleDocJson, styleConfig(), "en-US");

    expect(html).toContain("<!doctype html>");
    expect(html).toContain('<html lang="en-US">');
    expect(html).toContain("<style>");
    expect(html).toContain("@page { size: A4;");
    expect(html).toContain("</html>");
  });

  it("renders elements with td-resume-* CSS classes", () => {
    const html = renderStyledHtml(sampleDocJson, styleConfig(), "en-US");

    expect(html).toContain('<h1 class="td-resume-heading1">');
    expect(html).toContain('<p class="td-resume-paragraph">');
    expect(html).toContain('<ul class="td-resume-bulletList">');
    expect(html).toContain('<p class="td-resume-paragraph td-resume-bulletListText">');
  });

  it("embeds BlockStyle CSS in the style tag", () => {
    const html = renderStyledHtml(sampleDocJson, styleConfig(), "en-US");

    expect(html).toContain(".td-resume-heading1 {");
    expect(html).toContain(".td-resume-paragraph {");
    expect(html).toContain(".td-resume-bulletList {");
  });

  it("renders specific CSS properties from BlockStyle config", () => {
    const html = renderStyledHtml(sampleDocJson, styleConfig(), "en-US");

    expect(html).toContain("font-size: 18px;");
    expect(html).toContain("color: #1f2937;");
    expect(html).toContain("font-weight: 700;");
    expect(html).toContain("line-height: 1.55;");
    expect(html).toContain("list-style-type: disc;");
    expect(html).toContain("padding-left: 20px;");
  });

  it("splits list structure styles from list text override styles", () => {
    const html = renderStyledHtml(
      sampleDocJson,
      {
        ...styleConfig(),
        blocks: {
          ...styleConfig().blocks,
          bulletList: {
          fontSize: "12px",
          backgroundColor: "#eeeeee",
          listStyleType: "disc",
          paddingLeft: "20px",
          },
        },
      },
      "en-US",
    );

    expect(html).toContain(".td-resume-bulletList {\n  list-style-type: disc;\n  padding-left: 20px;\n}");
    expect(html).toContain(".td-resume-bulletListText {\n  font-size: 12px;\n  background-color: #eeeeee;\n}");
  });

  it("handles orderedList with td-resume-orderedList class", () => {
    const orderedDoc = {
      type: "doc",
      content: [
        {
          type: "orderedList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "First item" }],
                },
              ],
            },
          ],
        },
      ],
    };

    const html = renderStyledHtml(orderedDoc, styleConfig(), "en-US");

    expect(html).toContain('<ol class="td-resume-orderedList">');
    expect(html).toContain('<p class="td-resume-paragraph td-resume-orderedListText">First item</p>');
  });

  it("renders inlineStyle marks for selected text overrides", () => {
    const html = renderStyledContentHtml({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Normal " },
            {
              type: "text",
              text: "highlight",
              marks: [
                {
                  type: "inlineStyle",
                  attrs: { fontSize: "12px", color: "#174ea6" },
                },
              ],
            },
          ],
        },
      ],
    }, styleConfig());

    expect(html).toContain(
      '<span data-td-inline-style style="font-size: 12px; color: #174ea6">highlight</span>',
    );
  });

  it("renders editor toolbar node attrs and underline marks in styled content", () => {
    const html = renderStyledContentHtml({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { textAlign: "center", lineHeight: "1.5", indent: 2 },
          content: [{ type: "text", text: "Underlined", marks: [{ type: "underline" }] }],
        },
        {
          type: "horizontalRule",
        },
        {
          type: "bulletList",
          attrs: { listStyleType: "circle" },
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  attrs: { textAlign: "right" },
                  content: [{ type: "text", text: "Bullet item" }],
                },
              ],
            },
          ],
        },
        {
          type: "orderedList",
          attrs: { listStyleType: "lower-alpha" },
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Ordered item" }],
                },
              ],
            },
          ],
        },
      ],
    }, styleConfig());

    expect(html).toContain(
      '<p class="td-resume-paragraph" style="text-align: center; line-height: 1.5; margin-left: 3em"><u>Underlined</u></p>',
    );
    expect(html).toContain('<hr class="td-resume-divider">');
    expect(html).toContain('<ul class="td-resume-bulletList" style="list-style-type: circle">');
    expect(html).toContain(
      '<p class="td-resume-paragraph td-resume-bulletListText" style="text-align: right">Bullet item</p>',
    );
    expect(html).toContain('<ol class="td-resume-orderedList" style="list-style-type: lower-alpha">');
  });

  it("renders styled content fragments for previews and sanitizes column attrs", () => {
    const html = renderStyledContentHtml({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Alex" }],
        },
        {
          type: "columns",
          attrs: { count: 9, gap: "invalid" },
          content: [
            {
              type: "column",
              content: [
                {
                  type: "orderedList",
                  content: [
                    {
                      type: "listItem",
                      content: [
                        {
                          type: "paragraph",
                          content: [
                            { type: "text", text: "Built " },
                            { type: "text", text: "PDF", marks: [{ type: "bold" }] },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }, styleConfig());

    expect(html).toContain('<h1 class="td-resume-heading1">Alex</h1>');
    expect(html).toContain('<div class="td-columns" data-count="2" data-gap="default" data-widths="50,50"');
    expect(html).toContain('<ol class="td-resume-orderedList">');
    expect(html).toContain('<p class="td-resume-paragraph td-resume-orderedListText">Built <strong>PDF</strong></p>');
  });
  it("resets browser default block spacing in styled HTML", () => {
    const html = renderStyledHtml(sampleDocJson, styleConfig(), "en-US");

    expect(html).toContain(":where(.td-resume-page h1");
    expect(html).toContain(".td-resume-page p");
    expect(html).toContain("padding-left: 0;");
  });
});

describe("H2 heading decorations", () => {
  const h2Doc = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [
          { type: "text", text: "教育", marks: [{ type: "bold" }] },
          {
            type: "text",
            text: "经历",
            marks: [
              { type: "underline" },
              { type: "inlineStyle", attrs: { color: "#123456", backgroundColor: "#fedcba" } },
            ],
          },
        ],
      },
    ],
  };

  it("mixes an accent with white using the shared 12 percent rule", () => {
    expect(mixHexWithWhite("#000000")).toBe("#e0e0e0");
    expect(mixHexWithWhite("#FFFFFF")).toBe("#ffffff");
    expect(mixHexWithWhite("#174ea6")).toBe("#e3eaf4");
  });

  it.each(["minimal-line", "accent-wash", "dot-ribbon"] as const)(
    "renders %s with the same three real spans and keeps marks inside content",
    (decorationStyle) => {
      const html = renderStyledContentHtml(h2Doc, styleConfig(decorationStyle));

      expect(html).toContain(`data-heading-style="${decorationStyle}"`);
      expect(html).toContain('<span class="td-heading-prefix" aria-hidden="true"></span>');
      expect(html).toContain('<span class="td-heading-content"><strong>教育</strong><span data-td-inline-style style="color: #123456; background-color: #fedcba"><u>经历</u></span></span>');
      expect(html).toContain('<span class="td-heading-suffix" aria-hidden="true"></span>');
      expect(html.match(/教育/g)).toHaveLength(1);
      expect(html).not.toContain("::before");
      expect(html).not.toContain("::after");
    },
  );

  it("uses print-safe explicit dimensions for the accent wash spans", () => {
    const css = generateTemplateCSS(styleConfig("accent-wash"));

    expect(css).toContain("position: relative;\n  isolation: isolate;\n  z-index: 0;\n  break-after: avoid;");
    expect(css).toContain("height: calc(100% - 8px);");
    expect(css).toContain("width: 100%;");
    expect(css).toContain("height: 100%;");
    expect(css).not.toContain("inset: 0;");
  });

  it.each(["minimal-line", "accent-wash", "dot-ribbon"] as const)(
    "generates scoped %s CSS with page-break protection and no pseudo elements",
    (decorationStyle) => {
      const config = styleConfig(decorationStyle);
      const css = generateTemplateCSS(config);
      const workspaceCss = generateWorkspaceTemplateCSS(config, ".editor-scope");

      expect(css).toContain(`--td-heading-accent: ${config.theme.accentColor};`);
      expect(css).toContain("--td-heading-accent-soft: #e3eaf4;");
      expect(css).toContain(`.td-resume-heading2[data-heading-style="${decorationStyle}"]`);
      expect(css).toContain("break-after: avoid;");
      expect(css).toContain("break-inside: avoid;");
      expect(workspaceCss).toContain(`.editor-scope h2[data-heading-style="${decorationStyle}"]`);
      expect(css).not.toContain("::before");
      expect(css).not.toContain("::after");
    },
  );

  it("keeps list text rules scoped to their own list type in workspace CSS", () => {
    const config = styleConfig();
    config.blocks.bulletList = { color: "#111111", listStyleType: "disc" };
    config.blocks.orderedList = { color: "#222222", listStyleType: "decimal" };

    const css = generateWorkspaceTemplateCSS(config);

    expect(css).toContain(".rm-with-pagination ul {\n  list-style-type: disc;");
    expect(css).toContain(".rm-with-pagination ul li, .rm-with-pagination ul li p {\n  color: #111111;");
    expect(css).toContain(".rm-with-pagination ol {\n  list-style-type: decimal;");
    expect(css).toContain(".rm-with-pagination ol li, .rm-with-pagination ol li p {\n  color: #222222;");
    expect(css).not.toContain(".rm-with-pagination ul, .rm-with-pagination li");
    expect(css).not.toContain(".rm-with-pagination ol, .rm-with-pagination li");
  });

  it("emits nested list rules after workspace base list rules", () => {
    const css = generateWorkspaceTemplateCSS(styleConfig(), ".custom-scope");

    expect(css).toContain(".custom-scope ul ul {\n  list-style-type: circle;");
    expect(css).toContain(".custom-scope ul ul ul {\n  list-style-type: square;");
    expect(css).toContain(".custom-scope ol ol {\n  list-style-type: lower-alpha;");
    expect(css).toContain(".custom-scope ol ol ol {\n  list-style-type: lower-roman;");
    expect(css.indexOf(".custom-scope ul {\n")).toBeLessThan(css.indexOf(".custom-scope ul ul {\n"));
    expect(css.indexOf(".custom-scope ol {\n")).toBeLessThan(css.indexOf(".custom-scope ol ol {\n"));
  });

  it("keeps long and column H2 spans inside their own headings", () => {
    const html = renderStyledContentHtml({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "这是一个会换行但装饰节点不能脱离标题的很长标题" }],
        },
        {
          type: "columns",
          attrs: { count: 2, gap: "compact" },
          content: [
            {
              type: "column",
              content: [
                { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "分栏标题" }] },
              ],
            },
          ],
        },
      ],
    }, styleConfig("dot-ribbon"));

    const headings = html.match(/<h2[\s\S]*?<\/h2>/g) ?? [];
    expect(headings).toHaveLength(2);
    for (const heading of headings) {
      expect(heading.match(/td-heading-prefix/g)).toHaveLength(1);
      expect(heading.match(/td-heading-content/g)).toHaveLength(1);
      expect(heading.match(/td-heading-suffix/g)).toHaveLength(1);
    }
  });
});
