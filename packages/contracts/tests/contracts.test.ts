import { describe, expect, it } from "vitest";
import {
  pdfClassPolicySchema,
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
  it("validates template style config", () => {
    const parsed = templateStyleConfigSchema.parse({
      template_id: "classic-a4",
      slots: {
        page: {
          label: {
            "zh-CN": "页面",
            "en-US": "Page"
          },
          class_name: "bg-white text-slate-900 font-sans",
          allowed_class_groups: ["background-color", "text-color", "font-family"]
        }
      },
      updated_at: "2026-05-08T08:00:00.000Z"
    });

    expect(parsed.slots.page.class_name).toContain("bg-white");
    expect(parsed.slots.page.label["zh-CN"]).toBe("页面");
    expect(parsed.updated_at).toBe("2026-05-08T08:00:00.000Z");
  });

  it("defaults allowed class groups to an empty list", () => {
    const parsed = templateStyleConfigSchema.parse({
      template_id: "classic-a4",
      slots: {
        page: {
          label: {
            "zh-CN": "页面",
            "en-US": "Page"
          },
          class_name: "bg-white text-slate-900 font-sans"
        }
      },
      updated_at: "2026-05-08T08:00:00.000Z"
    });

    expect(parsed.slots.page.allowed_class_groups).toEqual([]);
  });

  it("requires an updated timestamp", () => {
    expect(() =>
      templateStyleConfigSchema.parse({
        template_id: "classic-a4",
        slots: {
          page: {
            label: {
              "zh-CN": "页面",
              "en-US": "Page"
            },
            class_name: "bg-white text-slate-900 font-sans"
          }
        }
      })
    ).toThrow();
  });

  it("requires localized slot labels", () => {
    expect(() =>
      templateStyleConfigSchema.parse({
        template_id: "classic-a4",
        slots: {
          page: {
            label: "Page",
            class_name: "bg-white text-slate-900 font-sans"
          }
        },
        updated_at: "2026-05-08T08:00:00.000Z"
      })
    ).toThrow();
  });
});

describe("pdfClassPolicySchema", () => {
  it("validates pdf class policy", () => {
    const parsed = pdfClassPolicySchema.parse({
      allowlist: ["bg-white", "text-slate-900"],
      blocklist: ["fixed", "sticky"],
      groups: {
        "text-color": {
          label: {
            "zh-CN": "文本颜色",
            "en-US": "Text color"
          },
          allowlist: ["text-slate-900", "text-slate-700"]
        }
      },
      updated_at: "2026-05-08T08:00:00.000Z"
    });

    expect(parsed.groups["text-color"].allowlist).toContain("text-slate-900");
    expect(parsed.groups["text-color"].label["en-US"]).toBe("Text color");
    expect(parsed.updated_at).toBe("2026-05-08T08:00:00.000Z");
  });

  it("defaults group blocklists to an empty list", () => {
    const parsed = pdfClassPolicySchema.parse({
      allowlist: ["bg-white", "text-slate-900"],
      groups: {
        "text-color": {
          label: {
            "zh-CN": "文本颜色",
            "en-US": "Text color"
          },
          allowlist: ["text-slate-900", "text-slate-700"]
        }
      },
      updated_at: "2026-05-08T08:00:00.000Z"
    });

    expect(parsed.groups["text-color"].blocklist).toEqual([]);
  });

  it("requires policy group labels and an updated timestamp", () => {
    expect(() =>
      pdfClassPolicySchema.parse({
        allowlist: ["bg-white", "text-slate-900"],
        groups: {
          "text-color": {
            allowlist: ["text-slate-900", "text-slate-700"]
          }
        },
        updated_at: "2026-05-08T08:00:00.000Z"
      })
    ).toThrow();

    expect(() =>
      pdfClassPolicySchema.parse({
        allowlist: ["bg-white", "text-slate-900"],
        groups: {
          "text-color": {
            label: {
              "zh-CN": "文本颜色",
              "en-US": "Text color"
            },
            allowlist: ["text-slate-900", "text-slate-700"]
          }
        }
      })
    ).toThrow();
  });
});
