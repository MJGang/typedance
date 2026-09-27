import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { captureCanvasPrintSnapshot } from "./canvasPrintSnapshot"

beforeEach(() => {
  // jsdom 不实现 Typed OM；真实浏览器中的行高及分页回归在 e2e 中验证。
  Object.defineProperty(HTMLElement.prototype, "computedStyleMap", {
    configurable: true,
    value(this: HTMLElement) {
      return new Map([["line-height", getComputedStyle(this).lineHeight]])
    },
  })
})

afterEach(() => {
  document.body.innerHTML = ""
  Reflect.deleteProperty(HTMLElement.prototype, "computedStyleMap")
  vi.restoreAllMocks()
})

describe("captureCanvasPrintSnapshot", () => {
  it("preserves measured page offsets, empty lines and formatting without editor controls", () => {
    const editor = document.createElement("div")
    editor.style.cssText = "width:794px;--rm-page-height:1123px;font-size:12px;line-height:18px"
    editor.innerHTML = '<div class="rm-pagination-gap"></div><div class="rm-pagination-gap"></div><p><a href="tel:12345">First</a></p><p><br class="ProseMirror-trailingBreak"></p><p style="text-align:right">Last<br><br></p><button>Delete</button><script>alert(1)</script>'
    document.body.append(editor)
    vi.spyOn(editor, "getBoundingClientRect").mockReturnValue({ top: 50, width: 794 } as DOMRect)
    const gaps = editor.querySelectorAll<HTMLElement>(".rm-pagination-gap")
    vi.spyOn(gaps[0], "getBoundingClientRect").mockReturnValue({ top: 1173, bottom: 1197, height: 24 } as DOMRect)
    vi.spyOn(gaps[1], "getBoundingClientRect").mockReturnValue({ top: 2320, bottom: 2320, height: 0 } as DOMRect)

    const snapshot = captureCanvasPrintSnapshot(editor)
    const exported = document.createElement("div")
    exported.innerHTML = snapshot.html

    expect(snapshot).toMatchObject({ page_width: 794, page_height: 1123, page_tops: [0, 1147] })
    expect(exported.querySelectorAll("p")).toHaveLength(3)
    expect(exported.querySelectorAll("br")).toHaveLength(3)
    expect(exported.querySelectorAll("button,script")).toHaveLength(0)
    expect(exported.querySelector("a")?.getAttribute("href")).toBe("tel:12345")
    expect(exported.querySelectorAll("p")[2].style.textAlign).toBe("right")
    expect(editor.querySelector("button")).not.toBeNull()
  })

  it("rejects an unmeasured editor instead of exporting a different layout", () => {
    expect(() => captureCanvasPrintSnapshot(document.createElement("div"))).toThrow()
  })
})
