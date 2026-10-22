import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"
import { EditorReferencesProvider, useEditorReferences } from "./EditorReferences"
import { MessageReferences, ReferenceComposer } from "./ReferenceComposer"
import type { EditorReference } from "@typedance/contracts"

afterEach(cleanup)

function Harness({ onSend }: { onSend: (references: EditorReference[]) => void }) {
  const references = useEditorReferences()!
  return <>
    <button onClick={() => references.add({ label: "工作经历", text: "负责需求分析", comment: "精简表达", source: { kind: "message", message_id: "message_1" } })}>添加第一条</button>
    <button onClick={() => references.add({ label: "项目经历", text: "完成系统开发", comment: "突出贡献", source: { kind: "message", message_id: "message_2" } })}>添加第二条</button>
    <ReferenceComposer />
    <button onClick={() => onSend(references.getPayload().references)}>发送</button>
  </>
}

describe("reference comments", () => {
  it("shows each original and instruction, supports editing one comment and deleting another reference", async () => {
    const onSend = vi.fn()
    render(<EditorReferencesProvider documentId="doc"><Harness onSend={onSend} /></EditorReferencesProvider>)
    fireEvent.click(screen.getByText("添加第一条"))
    fireEvent.click(screen.getByText("添加第二条"))
    fireEvent.click(screen.getByRole("button", { name: "查看 2 处引用" }))
    expect(await screen.findByText("负责需求分析")).toBeInTheDocument()
    expect(screen.getByText("突出贡献")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "编辑引用 1 的修改要求" }))
    fireEvent.change(screen.getByLabelText("引用 1 的修改要求"), { target: { value: "精简，但保留全部事实" } })
    fireEvent.click(screen.getByRole("button", { name: "保存要求" }))
    fireEvent.click(screen.getByRole("button", { name: "删除引用 2" }))
    expect(screen.queryByText("完成系统开发")).not.toBeInTheDocument()
    fireEvent.keyDown(document.activeElement!, { key: "Escape" })
    fireEvent.click(screen.getByText("发送"))
    expect(onSend).toHaveBeenCalledWith([expect.objectContaining({ text: "负责需求分析", comment: "精简，但保留全部事实" })])
  })

  it("keeps the original text and its instruction together when rendering a historical user message", () => {
    render(<MessageReferences references={[{ id: "ref", ordinal: 1, document_id: "doc", label: "工作经历", text: "当时选中的原文", comment: "保留数字，只精简措辞", source: { kind: "message", message_id: "message" } }]} />)
    expect(screen.getByText("当时选中的原文")).toBeInTheDocument()
    expect(screen.getByText("保留数字，只精简措辞")).toBeInTheDocument()
  })
})
