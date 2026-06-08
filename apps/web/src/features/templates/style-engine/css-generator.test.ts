import { describe, expect, it } from "vitest"
import { generateWorkspaceCSS } from "./css-generator"

describe("generateWorkspaceCSS", () => {
  it("scopes list item styles to their own list type", () => {
    const css = generateWorkspaceCSS({
      bulletList: { color: "#111111", listStyleType: "disc" },
      orderedList: { color: "#222222", listStyleType: "decimal" },
    })

    expect(css).toContain(".rm-with-pagination ul {\n  list-style-type: disc;")
    expect(css).toContain(".rm-with-pagination ul li, .rm-with-pagination ul li p {\n  color: #111111;")
    expect(css).toContain(".rm-with-pagination ol {\n  list-style-type: decimal;")
    expect(css).toContain(".rm-with-pagination ol li, .rm-with-pagination ol li p {\n  color: #222222;")
    expect(css).not.toContain(".rm-with-pagination ul, .rm-with-pagination li")
    expect(css).not.toContain(".rm-with-pagination ol, .rm-with-pagination li")
  })

  it("emits scoped nested list marker and indent rules after base list rules", () => {
    const css = generateWorkspaceCSS({
      bulletList: { listStyleType: "disc", paddingLeft: "18px" },
      orderedList: { listStyleType: "decimal", paddingLeft: "18px" },
    }, ".custom-scope")

    expect(css).toContain(".custom-scope ul ul {\n  list-style-type: circle;")
    expect(css).toContain(".custom-scope ul ul ul {\n  list-style-type: square;")
    expect(css).toContain(".custom-scope ol ol {\n  list-style-type: lower-alpha;")
    expect(css).toContain(".custom-scope ol ol ol {\n  list-style-type: lower-roman;")
    expect(css).toContain(".custom-scope li > ul, .custom-scope li > ol {\n  margin-top:")
    expect(css).toContain("  margin-bottom:")
    expect(css).toContain("  padding-left:")
    expect(css.indexOf(".custom-scope ul {\n")).toBeLessThan(css.indexOf(".custom-scope ul ul {\n"))
    expect(css.indexOf(".custom-scope ol {\n")).toBeLessThan(css.indexOf(".custom-scope ol ol {\n"))
  })
})
