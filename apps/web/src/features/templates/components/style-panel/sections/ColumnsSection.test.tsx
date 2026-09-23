import "@testing-library/jest-dom/vitest"
import { fireEvent, render, screen } from "@testing-library/react"
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

  it("offers up to six columns and applies the selected count", () => {
    const onCountChange = vi.fn()
    render(
      <ColumnsSection
        count={4}
        gap="default"
        onCountChange={onCountChange}
        onGapChange={vi.fn()}
        onUnsetColumns={vi.fn()}
      />,
    )

    expect(screen.getByText("4 栏")).toBeInTheDocument()
    expect(screen.getByText("5 栏")).toBeInTheDocument()
    fireEvent.click(screen.getByText("6 栏"))
    expect(onCountChange).toHaveBeenCalledWith(6)
  })
})
