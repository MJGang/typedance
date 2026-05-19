import { describe, expect, it } from "vitest";
import { renderResumeHtml, renderStyledContentHtml, renderStyledHtml } from "../src/index";

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
  paragraph: {
    fontSize: "10px",
    lineHeight: 1.55,
  },
  bulletList: {
    listStyleType: "disc" as const,
    paddingLeft: "20px",
  },
};

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
  it("outputs a complete HTML document with doctype and html tag", () => {
    const html = renderStyledHtml(sampleDocJson, sampleBlocks, "en-US");

    expect(html).toContain("<!doctype html>");
    expect(html).toContain('<html lang="en-US">');
    expect(html).toContain("<style>");
    expect(html).toContain("@page { size: A4;");
    expect(html).toContain("</html>");
  });

  it("renders elements with td-resume-* CSS classes", () => {
    const html = renderStyledHtml(sampleDocJson, sampleBlocks, "en-US");

    expect(html).toContain('<h1 class="td-resume-heading1">');
    expect(html).toContain('<p class="td-resume-paragraph">');
    expect(html).toContain('<ul class="td-resume-bulletList">');
    expect(html).toContain('<p class="td-resume-paragraph td-resume-bulletListText">');
  });

  it("embeds BlockStyle CSS in the style tag", () => {
    const html = renderStyledHtml(sampleDocJson, sampleBlocks, "en-US");

    expect(html).toContain(".td-resume-heading1 {");
    expect(html).toContain(".td-resume-paragraph {");
    expect(html).toContain(".td-resume-bulletList {");
  });

  it("renders specific CSS properties from BlockStyle config", () => {
    const html = renderStyledHtml(sampleDocJson, sampleBlocks, "en-US");

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
        ...sampleBlocks,
        bulletList: {
          fontSize: "12px",
          backgroundColor: "#eeeeee",
          listStyleType: "disc",
          paddingLeft: "20px",
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

    const html = renderStyledHtml(orderedDoc, {}, "en-US");

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
    });

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
    });

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
    });

    expect(html).toContain('<h1 class="td-resume-heading1">Alex</h1>');
    expect(html).toContain('<div class="td-columns" data-count="2" data-gap="default">');
    expect(html).toContain('<ol class="td-resume-orderedList">');
    expect(html).toContain('<p class="td-resume-paragraph td-resume-orderedListText">Built <strong>PDF</strong></p>');
  });
  it("resets browser default block spacing in styled HTML", () => {
    const html = renderStyledHtml(sampleDocJson, sampleBlocks, "en-US");

    expect(html).toContain(":where(.td-resume-page h1");
    expect(html).toContain(".td-resume-page p");
    expect(html).toContain("padding-left: 0;");
  });
});
