import "@testing-library/jest-dom/vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { beforeAll, describe, expect, it } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { defaultClassicA4Style } from "../../templates/data"
import { ResumeRichTextEditor } from "./ResumeRichTextEditor"

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  globalThis.ResizeObserver = ResizeObserverMock
})

describe("ResumeRichTextEditor H2 decorations", () => {
  it("keeps marked title content while switching decoration styles", async () => {
    const h2Doc = {
      type: "doc" as const,
      content: [{
        type: "heading",
        attrs: { level: 2, canvasNodeId: "node_1", sourceBlockId: "block_1", moduleId: "mod_1" },
        content: [
          { type: "text", text: "教育", marks: [{ type: "bold" }] },
          {
            type: "text",
            text: "经历",
            marks: [
              { type: "underline" },
              { type: "inlineStyle", attrs: { color: "#123456", backgroundColor: "#fedcba" } },
            ],
          },
        ],
      }],
    }
    const accentWashStyle = {
      ...defaultClassicA4Style,
      preset: "",
      blocks: {
        ...defaultClassicA4Style.blocks,
        heading2: {
          ...defaultClassicA4Style.blocks.heading2,
          decorationStyle: "accent-wash" as const,
        },
      },
    }
    const { rerender } = render(
      <TooltipProvider>
        <ResumeRichTextEditor
          ariaLabel="Resume text"
          templateStyle={defaultClassicA4Style}
          docJson={h2Doc}
          onChange={() => {}}
        />
      </TooltipProvider>,
    )

    const editorRoot = screen.getByLabelText("Resume text")
    const heading = screen.getByRole("heading", { level: 2, name: /教育\s*经历/ })
    const prefix = heading.querySelector<HTMLElement>(".td-heading-prefix")
    const content = heading.querySelector<HTMLElement>(".td-heading-content")
    const suffix = heading.querySelector<HTMLElement>(".td-heading-suffix")
    expect(heading).toHaveAttribute("data-heading-style", "minimal-line")
    expect(prefix).toHaveTextContent("")
    expect(prefix?.contentEditable).toBe("false")
    expect(content).toContainElement(screen.getByText("教育"))
    expect(content).toContainElement(screen.getByText("经历"))
    expect(content?.querySelector("strong")).toHaveTextContent("教育")
    expect(content?.querySelector("u")).toHaveTextContent("经历")
    expect(content?.querySelector("[data-td-inline-style]")).toHaveStyle({
      color: "rgb(18, 52, 86)",
      backgroundColor: "rgb(254, 220, 186)",
    })
    expect(suffix).toHaveTextContent("")
    expect(suffix?.contentEditable).toBe("false")

    rerender(
      <TooltipProvider>
        <ResumeRichTextEditor
          ariaLabel="Resume text"
          templateStyle={accentWashStyle}
          docJson={h2Doc}
          onChange={() => {}}
        />
      </TooltipProvider>,
    )

    const updatedHeading = await screen.findByRole("heading", { level: 2, name: /教育\s*经历/ })
    await waitFor(() => expect(updatedHeading).toHaveAttribute("data-heading-style", "accent-wash"))
    expect(screen.getByLabelText("Resume text")).toBe(editorRoot)
    expect(updatedHeading.textContent).toBe("教育经历")
    expect(updatedHeading.querySelector("strong")).toHaveTextContent("教育")
    expect(updatedHeading.querySelector("u")).toHaveTextContent("经历")
  })
})
