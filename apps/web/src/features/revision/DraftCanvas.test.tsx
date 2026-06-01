import "@testing-library/jest-dom/vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { forwardRef, useImperativeHandle } from "react"
import { describe, expect, it, vi } from "vitest"
import type { SourceResumeCanvas } from "@typedance/contracts"
import { DraftCanvas } from "./DraftCanvas"

const editorMocks = vi.hoisted(() => ({
  scrollToCanvasNode: vi.fn(),
}))

vi.mock("../workspace/components/ResumeRichTextEditor", () => ({
  ResumeRichTextEditor: forwardRef(function MockResumeRichTextEditor(
    { docJson }: { docJson: { content?: Array<{ content?: Array<{ text?: string }> }> } },
    ref,
  ) {
    useImperativeHandle(ref, () => ({
      setColumnsCount: vi.fn(),
      setColumnsGap: vi.fn(),
      unsetColumns: vi.fn(),
      scrollToCanvasNode: editorMocks.scrollToCanvasNode,
    }))

    return <div>{docJson.content?.[0]?.content?.[0]?.text}</div>
  }),
}))

const canvas: SourceResumeCanvas = {
  id: "canvas_1",
  document_id: "doc_1",
  old_resume_source_id: "src_1",
  doc_json: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { canvasNodeId: "node_project", sourceBlockId: "block_project", moduleId: "mod_1" },
        content: [{ type: "text", text: "负责核心链路重构。" }],
      },
    ],
  },
  node_map: [
    {
      canvas_node_id: "node_project",
      source_block_id: "block_project",
      node_type: "paragraph",
      text: "负责核心链路重构。",
      source_span: { line: 1 },
      module_id: "mod_1",
    },
  ],
  module_anchors: [
    {
      module_id: "mod_1",
      canvas_node_ids: ["node_project"],
      title: "项目经历",
      order: 0,
    },
  ],
  created_at: "2026-05-21T08:00:00.000Z",
  updated_at: "2026-05-21T08:00:00.000Z",
}

describe("DraftCanvas", () => {
  it("scrolls the editor to the first canvas node when an outline item is clicked", () => {
    render(<DraftCanvas canvas={canvas} onChange={vi.fn()} saveStatus="idle" />)

    fireEvent.click(screen.getByRole("button", { name: "项目经历" }))

    expect(editorMocks.scrollToCanvasNode).toHaveBeenCalledWith("node_project")
  })

  it("supports collapsing the module outline", () => {
    render(<DraftCanvas canvas={canvas} onChange={vi.fn()} saveStatus="idle" />)

    const toggle = screen.getByRole("button", { name: "折叠模块大纲" })
    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("button", { name: "项目经历" })).not.toBeInTheDocument()
  })

  it("announces save failures without hiding the original canvas", () => {
    render(<DraftCanvas canvas={canvas} onChange={vi.fn()} saveStatus="error" />)

    expect(screen.getByText("负责核心链路重构。")).toBeInTheDocument()
    expect(screen.getByText("保存失败")).toHaveAttribute("aria-live", "polite")
  })
})
