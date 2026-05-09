import { describe, expect, it } from "vitest"
import { makeResumeDocFromText, resumeDocToPlainText } from "./editor"

describe("resume editor document utilities", () => {
  it("converts plain resume text into paragraph document JSON", () => {
    expect(makeResumeDocFromText("Alice\n\nBuilt TypeDance")).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Alice" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Built TypeDance" }],
        },
      ],
    })
  })

  it("keeps an empty editor as a valid empty paragraph document", () => {
    expect(makeResumeDocFromText(" \n ")).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    })
  })

  it("extracts readable plain text from paragraphs and bullet lists", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Alice" }],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Built TypeDance" }],
                },
              ],
            },
          ],
        },
      ],
    }

    expect(resumeDocToPlainText(doc)).toBe("Alice\n\nBuilt TypeDance")
  })

  it("returns empty text for malformed document content", () => {
    expect(resumeDocToPlainText({ type: "doc", content: "abc" })).toBe("")
  })
})
