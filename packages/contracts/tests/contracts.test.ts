import { describe, expect, it } from "vitest";
import {
  resumeVersionSchema,
  templateSampleContentSchema,
  templateStyleConfigSchema
} from "../src/index";

describe("resumeVersionSchema", () => {
  it("accepts a minimal valid resume version", () => {
    const parsed = resumeVersionSchema.parse({
      id: "resume_1",
      title: "Backend Engineer Resume",
      target_language: "en-US",
      template_id: "classic-a4",
      doc_json: { type: "doc", content: [] },
      plain_text_snapshot: "",
      preview_pdf_path: null,
      preview_pdf_url: null,
      created_at: "2026-05-08T08:00:00.000Z",
      updated_at: "2026-05-08T08:00:00.000Z"
    });

    expect(parsed.source_refs).toEqual([]);
    expect(parsed.accepted_edit_ids).toEqual([]);
  });
});

describe("templateSampleContentSchema", () => {
  it("validates template sample content", () => {
    const parsed = templateSampleContentSchema.parse({
      id: "sample-tech-zh",
      name: {
        "zh-CN": "技术简历样张",
        "en-US": "Tech Resume Sample"
      },
      target_language: "zh-CN",
      doc_json: { type: "doc", content: [] },
      plain_text_snapshot: "技术简历样张",
      updated_at: "2026-05-08T08:00:00.000Z"
    });

    expect(parsed.id).toBe("sample-tech-zh");
  });
});

describe("templateStyleConfigSchema", () => {
  it("validates template style config with blocks", () => {
    const parsed = templateStyleConfigSchema.parse({
      template_id: "classic-a4",
      blocks: {
        heading1: { fontSize: "24pt", fontWeight: 700, color: "#1a1a1a", textAlign: "center" },
        paragraph: { fontSize: "10pt", lineHeight: 1.5, color: "#334155" },
      },
      updated_at: "2026-05-08T08:00:00.000Z"
    });

    expect(parsed.template_id).toBe("classic-a4");
    expect(parsed.preset).toBe("classic");
    expect(parsed.blocks.heading1.fontSize).toBe("24pt");
    expect(parsed.blocks.heading1.fontWeight).toBe(700);
    expect(parsed.updated_at).toBe("2026-05-08T08:00:00.000Z");
  });

  it("defaults blocks to an empty object", () => {
    const parsed = templateStyleConfigSchema.parse({
      template_id: "classic-a4",
      blocks: {},
      updated_at: "2026-05-08T08:00:00.000Z"
    });

    expect(parsed.blocks).toEqual({});
  });

  it("requires an updated timestamp", () => {
    expect(() =>
      templateStyleConfigSchema.parse({
        template_id: "classic-a4",
        blocks: {},
      })
    ).toThrow();
  });

  it("rejects unknown block type keys", () => {
    expect(() =>
      templateStyleConfigSchema.parse({
        template_id: "classic-a4",
        blocks: {
          unknownBlock: { fontSize: "12pt" },
        },
        updated_at: "2026-05-08T08:00:00.000Z"
      })
    ).toThrow();
  });
});

// PdfClassPolicySchema 已随 BlockStyle 架构迁移移除
