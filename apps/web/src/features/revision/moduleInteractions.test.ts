import { describe, expect, it } from "vitest"
import {
  canDockModuleOutline,
  clampModuleOutlinePanelWidth,
  getModuleOutlineLayout,
} from "./moduleInteractions"

describe("module outline positioning", () => {
  it("keeps the outline panel width between its minimum and maximum", () => {
    expect(clampModuleOutlinePanelWidth({ width: 320, height: 600 })).toBe(224)
    expect(clampModuleOutlinePanelWidth({ width: 1200, height: 600 })).toBe(264)
    expect(clampModuleOutlinePanelWidth({ width: 1800, height: 600 })).toBe(288)
  })

  it("docks only when the viewport can fit the minimum outline width, A4 page, gap, and right safe space", () => {
    expect(canDockModuleOutline({ width: 1065, height: 800 }, 794)).toBe(false)
    expect(canDockModuleOutline({ width: 1066, height: 800 }, 794)).toBe(true)
  })

  it("reserves left-side layout space only for the docked outline", () => {
    expect(getModuleOutlineLayout({ width: 1200, height: 800 }, 794)).toEqual({
      docked: true,
      panelWidth: 264,
      reservedWidth: 288,
    })
    expect(getModuleOutlineLayout({ width: 900, height: 800 }, 794)).toEqual({
      docked: false,
      panelWidth: 224,
      reservedWidth: 0,
    })
  })
})
