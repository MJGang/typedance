import type { ModuleAnchor } from "@typedance/contracts"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  buildModuleVisualRegions,
  clampOutlinePosition,
  getDefaultModuleOutlinePosition,
  loadModuleOutlinePreferences,
  moduleOutlineStorageKey,
  saveModuleOutlinePreferences,
} from "./moduleInteractions"

function anchor(
  moduleId: string,
  canvasNodeIds: string[],
  order = 0,
): ModuleAnchor {
  return {
    module_id: moduleId,
    canvas_node_ids: canvasNodeIds,
    title: moduleId,
    order,
  }
}

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
      activeModuleId: "module-active",
      hoveredModuleId: "module-hovered",
    } as Parameters<typeof saveModuleOutlinePreferences>[1] & {
      activeModuleId: string
      hoveredModuleId: string
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
        activeModuleId: "module-active",
        hoveredModuleId: "module-hovered",
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

describe("buildModuleVisualRegions", () => {
  it("merges rectangles from the same module on the same page into an envelope", () => {
    expect(
      buildModuleVisualRegions({
        anchors: [anchor("module-a", ["node-1", "node-2"])],
        nodes: [
          { canvasNodeId: "node-1", rect: { top: 10, bottom: 30, left: 5, right: 50 } },
          { canvasNodeId: "node-2", rect: { top: 40, bottom: 70, left: 15, right: 80 } },
        ],
        gaps: [],
      }),
    ).toEqual([
      {
        moduleId: "module-a",
        pageIndex: 0,
        top: 10,
        left: 5,
        width: 75,
        height: 60,
      },
    ])
  })

  it("splits a rectangle across a pagination gap without covering the gap", () => {
    expect(
      buildModuleVisualRegions({
        anchors: [anchor("module-a", ["node-1"])],
        nodes: [
          { canvasNodeId: "node-1", rect: { top: 80, bottom: 160, left: 10, right: 110 } },
        ],
        gaps: [{ top: 100, bottom: 120 }],
      }),
    ).toEqual([
      {
        moduleId: "module-a",
        pageIndex: 0,
        top: 80,
        left: 10,
        width: 100,
        height: 20,
      },
      {
        moduleId: "module-a",
        pageIndex: 1,
        top: 120,
        left: 10,
        width: 100,
        height: 40,
      },
    ])
  })

  it("assigns page indexes after multiple pagination gaps", () => {
    expect(
      buildModuleVisualRegions({
        anchors: [anchor("module-a", ["node-1"])],
        nodes: [
          { canvasNodeId: "node-1", rect: { top: 10, bottom: 310, left: 10, right: 110 } },
        ],
        gaps: [
          { top: 200, bottom: 230 },
          { top: 100, bottom: 120 },
        ],
      }),
    ).toEqual([
      {
        moduleId: "module-a",
        pageIndex: 0,
        top: 10,
        left: 10,
        width: 100,
        height: 90,
      },
      {
        moduleId: "module-a",
        pageIndex: 1,
        top: 120,
        left: 10,
        width: 100,
        height: 80,
      },
      {
        moduleId: "module-a",
        pageIndex: 2,
        top: 230,
        left: 10,
        width: 100,
        height: 80,
      },
    ])
  })

  it("skips pagination gaps with non-finite coordinates or non-positive dimensions", () => {
    expect(
      buildModuleVisualRegions({
        anchors: [anchor("module-a", ["node-1"])],
        nodes: [
          { canvasNodeId: "node-1", rect: { top: 80, bottom: 160, left: 10, right: 110 } },
        ],
        gaps: [
          { top: Number.NaN, bottom: 90 },
          { top: 140, bottom: Number.POSITIVE_INFINITY },
          { top: 95, bottom: 90 },
          { top: 100, bottom: 120 },
        ],
      }),
    ).toEqual([
      {
        moduleId: "module-a",
        pageIndex: 0,
        top: 80,
        left: 10,
        width: 100,
        height: 20,
      },
      {
        moduleId: "module-a",
        pageIndex: 1,
        top: 120,
        left: 10,
        width: 100,
        height: 40,
      },
    ])
  })

  it("merges overlapping pagination gaps before assigning page indexes", () => {
    expect(
      buildModuleVisualRegions({
        anchors: [anchor("module-a", ["node-1"])],
        nodes: [
          { canvasNodeId: "node-1", rect: { top: 80, bottom: 170, left: 10, right: 110 } },
        ],
        gaps: [
          { top: 100, bottom: 130 },
          { top: 120, bottom: 150 },
        ],
      }),
    ).toEqual([
      {
        moduleId: "module-a",
        pageIndex: 0,
        top: 80,
        left: 10,
        width: 100,
        height: 20,
      },
      {
        moduleId: "module-a",
        pageIndex: 1,
        top: 150,
        left: 10,
        width: 100,
        height: 20,
      },
    ])
  })

  it("merges duplicate pagination gaps before assigning page indexes", () => {
    expect(
      buildModuleVisualRegions({
        anchors: [anchor("module-a", ["node-1"])],
        nodes: [
          { canvasNodeId: "node-1", rect: { top: 80, bottom: 160, left: 10, right: 110 } },
        ],
        gaps: [
          { top: 100, bottom: 120 },
          { top: 100, bottom: 120 },
        ],
      }),
    ).toEqual([
      {
        moduleId: "module-a",
        pageIndex: 0,
        top: 80,
        left: 10,
        width: 100,
        height: 20,
      },
      {
        moduleId: "module-a",
        pageIndex: 1,
        top: 120,
        left: 10,
        width: 100,
        height: 40,
      },
    ])
  })

  it("skips missing nodes and rectangles fully inside a gap", () => {
    expect(
      buildModuleVisualRegions({
        anchors: [anchor("module-a", ["missing", "inside-gap", "visible"])],
        nodes: [
          { canvasNodeId: "inside-gap", rect: { top: 105, bottom: 115, left: 10, right: 110 } },
          { canvasNodeId: "visible", rect: { top: 130, bottom: 150, left: 20, right: 100 } },
        ],
        gaps: [{ top: 100, bottom: 120 }],
      }),
    ).toEqual([
      {
        moduleId: "module-a",
        pageIndex: 1,
        top: 130,
        left: 20,
        width: 80,
        height: 20,
      },
    ])
  })

  it("skips rectangles with non-finite coordinates or non-positive dimensions", () => {
    expect(
      buildModuleVisualRegions({
        anchors: [
          anchor("module-a", [
            "valid",
            "nan-top",
            "infinite-right",
            "inverted-height",
            "zero-height",
            "inverted-width",
            "zero-width",
          ]),
        ],
        nodes: [
          { canvasNodeId: "valid", rect: { top: 10, bottom: 30, left: 5, right: 50 } },
          { canvasNodeId: "nan-top", rect: { top: Number.NaN, bottom: 30, left: 5, right: 50 } },
          {
            canvasNodeId: "infinite-right",
            rect: { top: 10, bottom: 30, left: 5, right: Number.POSITIVE_INFINITY },
          },
          { canvasNodeId: "inverted-height", rect: { top: 30, bottom: 10, left: 5, right: 50 } },
          { canvasNodeId: "zero-height", rect: { top: 10, bottom: 10, left: 5, right: 50 } },
          { canvasNodeId: "inverted-width", rect: { top: 10, bottom: 30, left: 50, right: 5 } },
          { canvasNodeId: "zero-width", rect: { top: 10, bottom: 30, left: 5, right: 5 } },
        ],
        gaps: [],
      }),
    ).toEqual([
      {
        moduleId: "module-a",
        pageIndex: 0,
        top: 10,
        left: 5,
        width: 45,
        height: 20,
      },
    ])
  })

  it("sorts regions by anchor order and then page index", () => {
    expect(
      buildModuleVisualRegions({
        anchors: [
          anchor("module-second", ["node-second"], 1),
          anchor("module-first", ["node-first-later", "node-first-earlier"], 0),
        ],
        nodes: [
          { canvasNodeId: "node-second", rect: { top: 20, bottom: 30, left: 0, right: 10 } },
          { canvasNodeId: "node-first-later", rect: { top: 120, bottom: 130, left: 0, right: 10 } },
          { canvasNodeId: "node-first-earlier", rect: { top: 90, bottom: 100, left: 0, right: 10 } },
        ],
        gaps: [{ top: 100, bottom: 120 }],
      }).map(({ moduleId, pageIndex }) => ({ moduleId, pageIndex })),
    ).toEqual([
      { moduleId: "module-first", pageIndex: 0 },
      { moduleId: "module-first", pageIndex: 1 },
      { moduleId: "module-second", pageIndex: 0 },
    ])
  })

  it("does not mutate anchors, nodes, or gaps", () => {
    const anchors = [anchor("module-a", ["node-1"])]
    const nodes = [
      { canvasNodeId: "node-1", rect: { top: 80, bottom: 160, left: 10, right: 110 } },
    ]
    const gaps = [
      { top: 200, bottom: 230 },
      { top: 100, bottom: 120 },
    ]
    const originalInputs = structuredClone({ anchors, nodes, gaps })

    buildModuleVisualRegions({ anchors, nodes, gaps })

    expect({ anchors, nodes, gaps }).toEqual(originalInputs)
  })
})
