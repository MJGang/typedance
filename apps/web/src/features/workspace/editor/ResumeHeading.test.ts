import { describe, expect, it } from "vitest"
import type { Editor } from "@tiptap/core"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"

import {
  createResumeHeading,
  createResumeHeadingNodeView,
  syncHeading2DecorationDom,
} from "./ResumeHeading"

function headingNode(level: 1 | 2 | 3): ProseMirrorNode {
  return {
    type: { name: "heading" },
    attrs: { level },
  } as unknown as ProseMirrorNode
}

describe("ResumeHeading", () => {
  it("creates an H2 NodeView with one editable content span and two inert decoration spans", () => {
    const view = createResumeHeadingNodeView(headingNode(2), () => "accent-wash")
    const dom = view.dom as HTMLElement
    const prefix = dom.children[0] as HTMLElement
    const content = dom.children[1] as HTMLElement
    const suffix = dom.children[2] as HTMLElement

    expect(dom.tagName).toBe("H2")
    expect(dom.dataset.headingStyle).toBe("accent-wash")
    expect(prefix.className).toBe("td-heading-prefix")
    expect(prefix.getAttribute("aria-hidden")).toBe("true")
    expect(prefix.contentEditable).toBe("false")
    expect(content.className).toBe("td-heading-content")
    expect(view.contentDOM).toBe(content)
    expect(suffix.className).toBe("td-heading-suffix")
    expect(suffix.getAttribute("aria-hidden")).toBe("true")
    expect(suffix.contentEditable).toBe("false")
  })

  it.each([1, 3] as const)("keeps level %s headings as ordinary editable elements", (level) => {
    const view = createResumeHeadingNodeView(headingNode(level), () => "minimal-line")

    expect((view.dom as HTMLElement).tagName).toBe(`H${level}`)
    expect(view.contentDOM).toBe(view.dom)
    expect((view.dom as HTMLElement).children).toHaveLength(0)
  })

  it("requests a NodeView rebuild when the heading level changes", () => {
    const view = createResumeHeadingNodeView(headingNode(2), () => "dot-ribbon")
    const update = view.update as (node: ProseMirrorNode) => boolean

    expect(update(headingNode(2))).toBe(true)
    expect(update(headingNode(3))).toBe(false)
  })

  it("updates rendered H2 decorations without changing document content", () => {
    const root = document.createElement("div")
    root.innerHTML = [
      '<h2 class="td-resume-heading2" data-heading-style="minimal-line">First</h2>',
      '<h2 class="td-resume-heading2" data-heading-style="minimal-line">Second</h2>',
    ].join("")
    const editor = { view: { dom: root } } as unknown as Editor

    syncHeading2DecorationDom(editor, "accent-wash")

    expect(Array.from(root.querySelectorAll("h2")).map((heading) => heading.getAttribute("data-heading-style")))
      .toEqual(["accent-wash", "accent-wash"])
    expect(root.textContent).toBe("FirstSecond")
  })

  it("returns a Heading extension with the resume node-view name", () => {
    expect(createResumeHeading(() => "minimal-line").name).toBe("heading")
  })
})
