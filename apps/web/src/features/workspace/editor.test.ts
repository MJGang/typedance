import { describe, expect, it } from "vitest"
import { markdownToResumeDocJson } from "@typedance/resume-markdown"
import { looksLikeMarkdown, makeResumeDocFromText, resumeDocToPlainText } from "./editor"
import type { ResumeDocJson } from "./editor"

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

  it("detects common Markdown resume structures", () => {
    expect(looksLikeMarkdown("# Alice\n\n## Experience\n\n- Built TypeDance")).toBe(true)
    expect(looksLikeMarkdown("Experience\n\n1. Built TypeDance")).toBe(true)
    expect(looksLikeMarkdown("Built **TypeDance** with [Tiptap](https://tiptap.dev)")).toBe(true)
  })

  it("does not treat plain resume text as Markdown", () => {
    expect(looksLikeMarkdown("Alice Chen\nFull-stack Engineer\nReact TypeScript Local-first Apps")).toBe(false)
  })

  it("uses the shared Markdown converter for resume content document JSON", () => {
    const doc = markdownToResumeDocJson("# Alice\n\n## Experience\n\n- Built TypeDance")
    expect(doc.type).toBe("doc")
    expect(doc.content?.[0]).toMatchObject({ type: "heading", attrs: { level: 1 } })
    expect(doc.content?.[1]).toMatchObject({ type: "heading", attrs: { level: 2 } })
    expect(doc.content?.[2]).toMatchObject({ type: "bulletList" })
    expect(resumeDocToPlainText(doc as ResumeDocJson)).toBe("Alice\n\nExperience\n\nBuilt TypeDance")
  })
})
