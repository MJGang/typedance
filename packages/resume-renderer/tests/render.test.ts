import { describe, expect, it } from "vitest";
import { renderResumeHtml } from "../src/index";

describe("renderResumeHtml", () => {
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