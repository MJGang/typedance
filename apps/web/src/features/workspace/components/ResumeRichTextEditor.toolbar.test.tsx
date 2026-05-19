import "@testing-library/jest-dom/vitest"
import { render, screen } from "@testing-library/react"
import { beforeAll, describe, expect, it } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { ResumeRichTextEditor } from "./ResumeRichTextEditor"

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  globalThis.ResizeObserver = ResizeObserverMock
})

describe("ResumeRichTextEditor toolbar", () => {
  it("renders the updated toolbar labels and grouped separators", () => {
    render(
      <TooltipProvider>
        <ResumeRichTextEditor
          ariaLabel="Resume text"
          docJson={{ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "正文" }] }] }}
          onChange={() => {}}
        />
      </TooltipProvider>,
    )

    expect(screen.getByRole("button", { name: "正文与标题" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "下划线" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "行高调整" }).querySelector(".lucide-list-collapse")).toBeInTheDocument()
    expect(screen.getAllByRole("separator")).toHaveLength(4)
    expect(screen.getAllByText("|")).toHaveLength(4)
  })
})
