import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  clampOutlinePosition,
  getDefaultModuleOutlinePosition,
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
      position: { x: 120, y: 48 },
    }
    const secondPreferences = {
      visible: false,
      expanded: true,
      position: { x: 36, y: 72 },
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
      position: { x: 120, y: 48 },
      unexpectedModuleState: "module-active",
    } as Parameters<typeof saveModuleOutlinePreferences>[1] & {
      unexpectedModuleState: string
    })

    expect(JSON.parse(localStorage.getItem(moduleOutlineStorageKey("document-a")) ?? "")).toEqual({
      visible: true,
      expanded: false,
      position: { x: 120, y: 48 },
    })
  })

  it("only loads visible, expanded, and position", () => {
    localStorage.setItem(
      moduleOutlineStorageKey("document-a"),
      JSON.stringify({
        visible: true,
        expanded: false,
        position: { x: 120, y: 48 },
        unexpectedModuleState: "module-active",
      }),
    )

    expect(loadModuleOutlinePreferences("document-a")).toEqual({
      visible: true,
      expanded: false,
      position: { x: 120, y: 48 },
    })
  })

  it("does not persist preferences with non-finite positions", () => {
    saveModuleOutlinePreferences("document-a", {
      visible: true,
      expanded: false,
      position: { x: Number.NaN, y: 48 },
    })

    expect(localStorage.getItem(moduleOutlineStorageKey("document-a"))).toBeNull()
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
          position: { x: 120, y: 48 },
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
    ["invalid shape", JSON.stringify({ visible: true, expanded: false })],
    [
      "non-finite position",
      JSON.stringify({ visible: true, expanded: false, position: { x: null, y: 48 } }),
    ],
  ])("returns null for %s", (_label, storedValue) => {
    if (storedValue !== null) {
      localStorage.setItem(moduleOutlineStorageKey("document-a"), storedValue)
    }

    expect(loadModuleOutlinePreferences("document-a")).toBeNull()
  })
})

describe("module outline positioning", () => {
  it("clamps positions at the top-left boundary", () => {
    expect(
      clampOutlinePosition(
        { x: -20, y: -10 },
        { width: 1000, height: 800 },
        { width: 300, height: 200 },
      ),
    ).toEqual({ x: 0, y: 0 })
  })

  it("clamps positions at the bottom-right boundary", () => {
    expect(
      clampOutlinePosition(
        { x: 900, y: 700 },
        { width: 1000, height: 800 },
        { width: 300, height: 200 },
      ),
    ).toEqual({ x: 700, y: 600 })
  })

  it("returns non-negative coordinates when the viewport is smaller than the outline", () => {
    expect(
      clampOutlinePosition(
        { x: 40, y: 30 },
        { width: 100, height: 80 },
        { width: 300, height: 200 },
      ),
    ).toEqual({ x: 0, y: 0 })
  })

  it("uses safe finite values for non-finite inputs", () => {
    const position = clampOutlinePosition(
      { x: Number.POSITIVE_INFINITY, y: Number.NaN },
      { width: Number.POSITIVE_INFINITY, height: 800 },
      { width: 300, height: Number.NEGATIVE_INFINITY },
    )

    expect(position).toEqual({ x: 0, y: 0 })
    expect(Number.isFinite(position.x)).toBe(true)
    expect(Number.isFinite(position.y)).toBe(true)
  })

  it("places the default outline at the safe top-right position", () => {
    expect(
      getDefaultModuleOutlinePosition(
        { width: 1200, height: 900 },
        { width: 250, height: 320 },
      ),
    ).toEqual({ x: 938, y: 48 })
  })
})
