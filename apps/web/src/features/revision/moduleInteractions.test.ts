import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  canDockModuleOutline,
  clampModuleOutlinePanelWidth,
  getModuleOutlineLayout,
  loadModuleOutlinePreferences,
  moduleOutlineStorageKey,
  saveModuleOutlinePreferences,
} from "./moduleInteractions"

describe("module outline preferences", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("uses the revision workspace module outline namespace", () => {
    expect(moduleOutlineStorageKey("document-42")).toBe(
      "typedance:revision-workspace:module-outline:document-42",
    )
  })

  it("saves and loads preferences independently for each document", () => {
    const firstPreferences = {
      visible: true,
      expanded: false,
    }
    const secondPreferences = {
      visible: false,
      expanded: true,
    }

    saveModuleOutlinePreferences("document-a", firstPreferences)
    saveModuleOutlinePreferences("document-b", secondPreferences)

    expect(loadModuleOutlinePreferences("document-a")).toEqual(firstPreferences)
    expect(loadModuleOutlinePreferences("document-b")).toEqual(secondPreferences)
  })

  it("only persists visible, expanded, and position", () => {
    saveModuleOutlinePreferences("document-a", {
      visible: true,
      expanded: false,
      unexpectedModuleState: "module-active",
    } as Parameters<typeof saveModuleOutlinePreferences>[1] & {
      unexpectedModuleState: string
    })

    expect(JSON.parse(localStorage.getItem(moduleOutlineStorageKey("document-a")) ?? "")).toEqual({
      visible: true,
      expanded: false,
    })
  })

  it("only loads visible, expanded, and position", () => {
    localStorage.setItem(
      moduleOutlineStorageKey("document-a"),
      JSON.stringify({
        visible: true,
        expanded: false,
        unexpectedModuleState: "module-active",
      }),
    )

    expect(loadModuleOutlinePreferences("document-a")).toEqual({
      visible: true,
      expanded: false,
    })
  })

  it("silently degrades when localStorage setItem throws a SecurityError", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError")
    })

    try {
      expect(() => {
        saveModuleOutlinePreferences("document-a", {
          visible: true,
          expanded: false,
        })
      }).not.toThrow()
    } finally {
      setItem.mockRestore()
    }
  })

  it.each([
    ["missing key", null],
    ["invalid JSON", "{"],
    ["null", "null"],
    ["invalid shape", JSON.stringify({ visible: true })],
  ])("returns null for %s", (_label, storedValue) => {
    if (storedValue !== null) {
      localStorage.setItem(moduleOutlineStorageKey("document-a"), storedValue)
    }

    expect(loadModuleOutlinePreferences("document-a")).toBeNull()
  })
})

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
