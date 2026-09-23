import type { Editor } from "@tiptap/core"
import Heading from "@tiptap/extension-heading"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import type { NodeView as ProseMirrorNodeView } from "@tiptap/pm/view"
import type { Heading2DecorationStyle } from "@typedance/contracts"

import {
  HEADING_CONTENT_CLASS,
  HEADING_PREFIX_CLASS,
  HEADING_SUFFIX_CLASS,
} from "@typedance/resume-renderer"

type HeadingStyleGetter = () => Heading2DecorationStyle

export function blockStyleToCss(attrs: Record<string, unknown>): string {
  const rules: string[] = []
  if (attrs.textAlign === "left" || attrs.textAlign === "center" || attrs.textAlign === "right" || attrs.textAlign === "justify") {
    rules.push(`text-align: ${attrs.textAlign}`)
  }
  if (typeof attrs.lineHeight === "string" && attrs.lineHeight !== "default") {
    rules.push(`line-height: ${attrs.lineHeight}`)
  }
  if (typeof attrs.indent === "number" && attrs.indent > 0) {
    rules.push(`margin-left: ${attrs.indent * 1.5}em`)
  }
  return rules.join("; ")
}

function syncBlockStyle(dom: HTMLElement, node: ProseMirrorNode): void {
  const style = blockStyleToCss(node.attrs)
  if (style) dom.style.cssText = style
  else dom.removeAttribute("style")
}

function createDecorationSpan(className: string): HTMLSpanElement {
  const element = document.createElement("span")
  element.className = className
  element.setAttribute("aria-hidden", "true")
  element.contentEditable = "false"
  return element
}

export function createResumeHeadingNodeView(
  node: ProseMirrorNode,
  getHeading2Style: HeadingStyleGetter,
): ProseMirrorNodeView {
  const level = node.attrs.level as number
  const dom = document.createElement(`h${level}`)
  dom.className = `td-resume-heading${level}`
  syncBlockStyle(dom, node)

  if (level !== 2) {
    return {
      dom,
      contentDOM: dom,
      update: (updatedNode) => {
        if (updatedNode.type.name !== node.type.name || updatedNode.attrs.level !== level) return false
        syncBlockStyle(dom, updatedNode)
        return true
      },
    }
  }

  dom.dataset.headingStyle = getHeading2Style()
  const prefix = createDecorationSpan(HEADING_PREFIX_CLASS)
  const contentDOM = document.createElement("span")
  contentDOM.className = HEADING_CONTENT_CLASS
  const suffix = createDecorationSpan(HEADING_SUFFIX_CLASS)
  dom.append(prefix, contentDOM, suffix)

  return {
    dom,
    contentDOM,
    update: (updatedNode) => {
      if (updatedNode.type.name !== node.type.name || updatedNode.attrs.level !== level) return false
      syncBlockStyle(dom, updatedNode)
      dom.dataset.headingStyle = getHeading2Style()
      return true
    },
    ignoreMutation: (mutation) => (
      mutation.type === "attributes"
      && mutation.target === dom
      && mutation.attributeName === "data-heading-style"
    ),
  }
}

export function createResumeHeading(getHeading2Style: HeadingStyleGetter) {
  return Heading.extend({
    addNodeView() {
      return ({ node }) => createResumeHeadingNodeView(node, getHeading2Style)
    },
  }).configure({ levels: [1, 2, 3] })
}

export function syncHeading2DecorationDom(
  editor: Editor,
  style: Heading2DecorationStyle,
): void {
  editor.view.dom.querySelectorAll<HTMLElement>(".td-resume-heading2").forEach((heading) => {
    heading.dataset.headingStyle = style
  })
}
