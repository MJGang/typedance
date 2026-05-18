import { describe, expect, it } from "vitest"
import { generateWorkspaceCSS } from "./css-generator"

describe("generateWorkspaceCSS", () => {
  it("scopes list item styles to their own list type", () => {
    const css = generateWorkspaceCSS({
      bulletList: { color: "#111111", listStyleType: "disc" },
      orderedList: { color: "#222222", listStyleType: "decimal" },
    })

    expect(css).toContain(".rm-with-pagination ul {\n  list-style-type: disc;")
    expect(css).toContain(".rm-with-pagination ul li p {\n  color: #111111;")
    expect(css).toContain(".rm-with-pagination ol {\n  list-style-type: decimal;")
    expect(css).toContain(".rm-with-pagination ol li p {\n  color: #222222;")
    expect(css).not.toContain(".rm-with-pagination ul, .rm-with-pagination li")
    expect(css).not.toContain(".rm-with-pagination ol, .rm-with-pagination li")
  })
})
