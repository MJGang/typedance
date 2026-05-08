import { describe, expect, it } from "vitest";
import { renderResumeHtml } from "../src/index";

describe("renderResumeHtml", () => {
  it("escapes resume text before rendering", () => {
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

    expect(html).toContain("A &lt; B");
    expect(html).toContain("Built &lt;secure&gt; export");
  });
});
