import "@testing-library/jest-dom/vitest"
import { fireEvent, render, screen } from "@testing-library/react"
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

describe("columns toolbar", () => {
  it("offers only meaningful two-column and three-column layouts", () => {
    render(
      <TooltipProvider>
        <ResumeRichTextEditor
          ariaLabel="Resume text"
          templateStyle={defaultClassicA4Style}
          docJson={{ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "正文" }] }] }}
          onChange={() => {}}
        />
      </TooltipProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "分栏" }))

    expect(screen.queryByRole("button", { name: "1 栏" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "2 栏" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "3 栏" })).toBeInTheDocument()
  })
})
