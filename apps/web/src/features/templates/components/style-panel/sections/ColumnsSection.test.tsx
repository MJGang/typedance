import "@testing-library/jest-dom/vitest"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ColumnsSection } from "./ColumnsSection"

describe("ColumnsSection", () => {
  it("does not offer a one-column layout", () => {
    render(
      <ColumnsSection
        count={2}
        gap="default"
        onCountChange={vi.fn()}
        onGapChange={vi.fn()}
        onUnsetColumns={vi.fn()}
      />,
    )

    expect(screen.queryByText("1 栏")).not.toBeInTheDocument()
    expect(screen.getByText("2 栏")).toBeInTheDocument()
    expect(screen.getByText("3 栏")).toBeInTheDocument()
  })
})
