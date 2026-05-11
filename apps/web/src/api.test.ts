import { afterEach, describe, expect, it, vi } from "vitest"
import { getTemplateSample, saveTemplateStyle } from "./api"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("template api", () => {
  it("loads a template sample", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: "sample-tech-zh",
              name: { "zh-CN": "通用技术岗样张", "en-US": "General technical sample" },
              target_language: "zh-CN",
              doc_json: { type: "doc", content: [] },
              plain_text_snapshot: "",
              updated_at: "2026-05-11T00:00:00.000Z",
            }),
          ),
      ),
    )

    await expect(getTemplateSample("sample-tech-zh")).resolves.toMatchObject({
      id: "sample-tech-zh",
    })
  })

  it("surfaces style validation failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              detail: [{ slot: "page", class_name: "fixed", reason: "blocked" }],
            }),
            { status: 422 },
          ),
      ),
    )

    await expect(
      saveTemplateStyle({
        template_id: "classic-a4",
        slots: {},
        updated_at: "2026-05-11T00:00:00.000Z",
      }),
    ).rejects.toThrow("fixed")
  })
})
