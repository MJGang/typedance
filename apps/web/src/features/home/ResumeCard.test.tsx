import "@testing-library/jest-dom/vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import type { MouseEvent, ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import type { ResumeVersion } from "@typedance/contracts"
import { defaultClassicA4Style } from "../templates/data"
import { ResumeCard } from "./ResumeCard"

type MockNodeProps = {
  children?: ReactNode
}

type MockItemProps = MockNodeProps & {
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void
}

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: MockNodeProps) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: MockNodeProps) => <>{children}</>,
  DropdownMenuContent: ({ children }: MockNodeProps) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: MockItemProps) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}))

const resume: ResumeVersion = {
  id: "resume_1",
  title: "旧简历",
  target_language: "zh-CN",
  template_id: "classic-a4",
  doc_json: { type: "doc", content: [] },
  plain_text_snapshot: "旧简历",
  source_refs: [],
  accepted_edit_ids: [],
  created_at: "2026-05-21T08:00:00.000Z",
  updated_at: "2026-05-21T08:00:00.000Z",
}

describe("ResumeCard", () => {
  it("offers a legacy resume projection action", () => {
    const onOpenRevision = vi.fn()

    render(
      <ResumeCard
        resume={resume}
        styleConfig={defaultClassicA4Style}
        onClick={vi.fn()}
        onOpenRevision={onOpenRevision}
        onDelete={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "用新工作台打开" }))

    expect(onOpenRevision).toHaveBeenCalled()
  })
})
