import "@testing-library/jest-dom/vitest"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { TemplateSampleContent, TemplateStyleConfig } from "../types"
import { TemplatePreview } from "./TemplatePreview"

const styleConfig: TemplateStyleConfig = {
  template_id: "classic-a4",
  preset: "classic",
  theme: { accentColor: "#174EA6" },
  blocks: {
    heading1: {},
    heading2: { decorationStyle: "accent-wash" },
    heading3: {},
    paragraph: {},
    bulletList: {},
    orderedList: {},
  },
  updated_at: "2026-01-01T00:00:00.000Z",
}

const sample: TemplateSampleContent = {
  id: "sample",
  name: { "zh-CN": "Sample", "en-US": "Sample" },
  target_language: "zh-CN",
  plain_text_snapshot: "",
  updated_at: "2026-01-01T00:00:00.000Z",
  doc_json: {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Experience" }] },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: "Closed loop" }] }],
          },
        ],
      },
      {
        type: "columns",
        attrs: { count: 3, gap: "compact" },
        content: [
          {
            type: "column",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "Local " },
                  { type: "text", text: "first", marks: [{ type: "italic" }] },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
}

describe("TemplatePreview", () => {
  it("renders sample blocks with export-aligned structure", () => {
    render(<TemplatePreview sample={sample} styleConfig={styleConfig} />)

    expect(screen.getByRole("heading", { level: 2, name: "Experience" })).toHaveClass("td-resume-heading2")
    expect(screen.getByRole("heading", { level: 2, name: "Experience" })).toHaveAttribute("data-heading-style", "accent-wash")
    expect(screen.getByRole("heading", { level: 2 }).querySelector(".td-heading-prefix")).toHaveAttribute("aria-hidden", "true")
    expect(screen.getByRole("heading", { level: 2 }).querySelector(".td-heading-content")).toHaveTextContent("Experience")
    expect(screen.getByRole("heading", { level: 2 }).querySelector(".td-heading-suffix")).toHaveAttribute("aria-hidden", "true")
    expect(screen.getByText("Closed loop")).toHaveClass("td-resume-paragraph", "td-resume-bulletListText")
    expect(screen.getByText("Closed loop").closest("ul")).toHaveClass("td-resume-bulletList")
    expect(screen.getByText("first").tagName).toBe("EM")
    expect(screen.getByText("Local", { exact: false }).closest(".td-columns")).toHaveAttribute("data-count", "3")
    expect(screen.getByText("Local", { exact: false }).closest(".td-columns")).toHaveAttribute("data-gap", "compact")
  })
})
