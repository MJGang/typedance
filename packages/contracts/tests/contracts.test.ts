import { describe, expect, it } from "vitest";
import { resumeVersionSchema } from "../src/index";

describe("resumeVersionSchema", () => {
  it("accepts a minimal valid resume version", () => {
    const parsed = resumeVersionSchema.parse({
      id: "resume_1",
      title: "Backend Engineer Resume",
      target_language: "en-US",
      template_id: "classic-a4",
      doc_json: { type: "doc", content: [] },
      plain_text_snapshot: "",
      created_at: "2026-05-08T08:00:00.000Z",
      updated_at: "2026-05-08T08:00:00.000Z"
    });

    expect(parsed.source_refs).toEqual([]);
    expect(parsed.accepted_edit_ids).toEqual([]);
  });
});
