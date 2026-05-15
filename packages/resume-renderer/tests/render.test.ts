import { describe, expect, it } from "vitest";
import { renderResumeHtml, renderStyledHtml } from "../src/index";

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
    fontSize: "18pt",
    color: "#1f2937",
    fontWeight: 700 as const,
  },
  paragraph: {
    fontSize: "10pt",
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
    expect(html).toContain('<li class="td-resume-bulletList">');
  });

  it("embeds BlockStyle CSS in the style tag", () => {
    const html = renderStyledHtml(sampleDocJson, sampleBlocks, "en-US");

    expect(html).toContain(".td-resume-heading1 {");
    expect(html).toContain(".td-resume-paragraph {");
    expect(html).toContain(".td-resume-bulletList {");
  });

  it("renders specific CSS properties from BlockStyle config", () => {
    const html = renderStyledHtml(sampleDocJson, sampleBlocks, "en-US");

    expect(html).toContain("font-size: 18pt;");
    expect(html).toContain("color: #1f2937;");
    expect(html).toContain("font-weight: 700;");
    expect(html).toContain("line-height: 1.55;");
    expect(html).toContain("list-style-type: disc;");
    expect(html).toContain("padding-left: 20px;");
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
    expect(html).toContain('<li class="td-resume-orderedList">');
  });
});
