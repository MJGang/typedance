import "@testing-library/jest-dom/vitest"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { TemplateStyleConfig } from "@typedance/contracts"
import { ResumePreview } from "./ResumePreview"

const styleConfig: TemplateStyleConfig = {
  template_id: "classic-a4",
  preset: "classic",
  blocks: {
    heading1: {},
    heading2: {},
    heading3: {},
    paragraph: {},
    bulletList: {},
    orderedList: {},
  },
  updated_at: "2026-01-01T00:00:00.000Z",
}

describe("ResumePreview", () => {
  it("renders resume blocks with export-aligned structure", () => {
    render(
      <ResumePreview
        styleConfig={styleConfig}
        docJson={{
          type: "doc",
          content: [
            { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Alex" }] },
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Built " },
                { type: "text", text: "PDF", marks: [{ type: "bold" }] },
                { type: "hardBreak" },
                { type: "text", text: "export" },
              ],
            },
            {
              type: "orderedList",
              content: [
                {
                  type: "listItem",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "First item" }] }],
                },
              ],
            },
            {
              type: "columns",
              attrs: { count: 2, gap: "wide" },
              content: [
                {
                  type: "column",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Left column" }] }],
                },
              ],
            },
          ],
        }}
      />,
    )

    expect(screen.getByRole("heading", { level: 1, name: "Alex" })).toHaveClass("td-resume-heading1")
    expect(screen.getByText("PDF").tagName).toBe("STRONG")
    expect(screen.getByText("First item")).toHaveClass("td-resume-paragraph", "td-resume-orderedListText")
    expect(screen.getByText("First item").closest("ol")).toHaveClass("td-resume-orderedList")
    expect(screen.getByText("Left column").closest(".td-columns")).toHaveAttribute("data-count", "2")
    expect(screen.getByText("Left column").closest(".td-columns")).toHaveAttribute("data-gap", "wide")
  })
})
