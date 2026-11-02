import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ColorPickerPopover } from "./color-picker-popover"

afterEach(cleanup)

function typeValue(input: HTMLElement, value: string) {
  for (let length = 1; length <= value.length; length++) fireEvent.change(input, { target: { value: value.slice(0, length) } })
}

function openPicker() {
  const onChange = vi.fn()
  render(<TooltipProvider><ColorPickerPopover kind="text" value="#213547" onChange={onChange} /></TooltipProvider>)
  fireEvent.click(screen.getByRole("button", { name: "文字颜色" }))
  return onChange
}

describe("custom colors", () => {
  it("keeps the popover open while typing HEX and commits only on Enter", async () => {
    const onChange = openPicker()
    const hex = screen.getByRole("textbox", { name: "HEX 颜色" })
    fireEvent.change(hex, { target: { value: "" } })
    typeValue(hex, "#123abc")
    expect(onChange).not.toHaveBeenCalled()
    expect(hex).toHaveValue("#123abc")
    expect(screen.getByRole("textbox", { name: "R 颜色值" })).toHaveValue("18")
    fireEvent.keyDown(hex, { key: "Enter" })
    expect(onChange).toHaveBeenCalledExactlyOnceWith("#123abc")
    expect(screen.queryByRole("textbox", { name: "HEX 颜色" })).not.toBeInTheDocument()
  })

  it("allows all three RGB channels to be entered digit by digit before applying", async () => {
    const onChange = openPicker()
    for (const [label, value] of [["R", "213"], ["G", "54"], ["B", "71"]]) {
      const input = screen.getByRole("textbox", { name: `${label} 颜色值` })
      fireEvent.change(input, { target: { value: "" } })
      typeValue(input, value)
      expect(input).toHaveValue(value)
      expect(onChange).not.toHaveBeenCalled()
    }
    expect(screen.getByRole("textbox", { name: "HEX 颜色" })).toHaveValue("#d53647")
    fireEvent.click(screen.getByRole("button", { name: "应用颜色" }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith("#d53647")
  })

  it("rejects invalid channels and discards an uncommitted draft on Escape", async () => {
    const onChange = openPicker()
    const channel = screen.getByRole("textbox", { name: "R 颜色值" })
    fireEvent.change(channel, { target: { value: "" } })
    typeValue(channel, "999")
    expect(screen.getByRole("button", { name: "应用颜色" })).toBeDisabled()
    fireEvent.keyDown(channel, { key: "Escape" })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "文字颜色" }))
    expect(screen.getByRole("textbox", { name: "R 颜色值" })).toHaveValue("33")
  })
})
