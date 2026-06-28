import { beforeEach, describe, expect, it } from "vitest"
import {
  DEFAULT_PANEL_WIDTHS,
  PANEL_WIDTH_STORAGE_KEY,
  loadPanelWidths,
  resolvePanelLayout,
  savePanelWidths,
} from "./panelLayout"

describe("panelLayout", () => {
  beforeEach(() => localStorage.clear())

  it("loads defaults and validates persisted values", () => {
    expect(loadPanelWidths()).toEqual(DEFAULT_PANEL_WIDTHS)

    localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, JSON.stringify({ left: 310, right: 470 }))
    expect(loadPanelWidths()).toEqual({ left: 310, right: 470 })

    localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, JSON.stringify({ left: "wide", right: 9999 }))
    expect(loadPanelWidths()).toEqual(DEFAULT_PANEL_WIDTHS)
  })

  it("persists requested panel widths", () => {
    savePanelWidths({ left: 300, right: 440 })

    expect(JSON.parse(localStorage.getItem(PANEL_WIDTH_STORAGE_KEY)!)).toEqual({
      left: 300,
      right: 440,
    })
  })

  it("preserves the canvas by shrinking the right panel before the left", () => {
    expect(resolvePanelLayout({
      containerWidth: 1200,
      leftVisible: true,
      rightVisible: true,
      requested: { left: 420, right: 560 },
    })).toEqual({
      left: 240,
      right: 320,
      leftMax: 240,
      rightMax: 320,
    })
  })

  it("restores requested width when a panel is hidden or space returns", () => {
    expect(resolvePanelLayout({
      containerWidth: 1200,
      leftVisible: true,
      rightVisible: false,
      requested: { left: 420, right: 560 },
    }).left).toBe(420)

    expect(resolvePanelLayout({
      containerWidth: 1800,
      leftVisible: true,
      rightVisible: true,
      requested: { left: 420, right: 560 },
    })).toMatchObject({ left: 420, right: 560 })
  })
})
