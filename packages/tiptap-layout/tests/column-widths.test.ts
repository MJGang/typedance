import { describe, expect, it } from "vitest"
import {
  columnGridTemplate,
  equalColumnWidths,
  normalizeColumnWidths,
  resizeColumnWidths,
} from "../src/columns"

describe("column width helpers", () => {
  it("falls back to equal widths when persisted widths are invalid", () => {
    expect(normalizeColumnWidths([80], 2)).toEqual([50, 50])
    expect(normalizeColumnWidths([50, -10, 60], 3)).toEqual([33.3333, 33.3333, 33.3334])
    expect(equalColumnWidths(3)).toEqual([33.3333, 33.3333, 33.3334])
  })

  it("normalizes valid persisted widths to one hundred percent", () => {
    expect(normalizeColumnWidths([2, 1], 2)).toEqual([66.6667, 33.3333])
  })

  it("resizes only the two columns adjacent to the dragged divider", () => {
    expect(resizeColumnWidths([30, 40, 30], 1, 10)).toEqual([30, 50, 20])
  })

  it("keeps both adjacent columns above the minimum width", () => {
    expect(resizeColumnWidths([50, 50], 0, 80)).toEqual([85, 15])
    expect(resizeColumnWidths([50, 50], 0, -80)).toEqual([15, 85])
  })

  it("builds a safe grid track declaration from normalized widths", () => {
    expect(columnGridTemplate([65, 35], 2)).toBe("minmax(0, 65fr) minmax(0, 35fr)")
  })
})
