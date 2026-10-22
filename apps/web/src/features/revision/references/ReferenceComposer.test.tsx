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
    <button onClick={() => references.add({ label: "专业技能", text: "熟悉系统设计", comment: "检查表述", source: { kind: "message", message_id: "message_3" } })}>添加第三条</button>
    <ReferenceComposer />
    <button onClick={() => onSend(references.getPayload().references)}>发送</button>
    <button onClick={() => {
      const sent = references.getPayload().references.slice(0, 2)
      onSend(sent)
      references.consume(sent.map((reference) => reference.id))
    }}>发送前两条</button>
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

  it("renumbers three quotes after deleting the first, appends the next number, and restarts after clearing", () => {
    const onSend = vi.fn()
    render(<EditorReferencesProvider documentId="doc"><Harness onSend={onSend} /></EditorReferencesProvider>)
    for (const name of ["添加第一条", "添加第二条", "添加第三条"]) fireEvent.click(screen.getByText(name))
    fireEvent.click(screen.getByText("发送"))
    const original = onSend.mock.lastCall![0] as EditorReference[]
    fireEvent.click(screen.getByRole("button", { name: "查看 3 处引用" }))
    fireEvent.click(screen.getByRole("button", { name: "删除引用 1" }))
    expect(screen.getByRole("button", { name: "1 · 项目经历" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "2 · 专业技能" })).toBeInTheDocument()
    fireEvent.click(screen.getByText("添加第一条"))
    expect(screen.getByRole("button", { name: "3 · 工作经历" })).toBeInTheDocument()
    fireEvent.click(screen.getByText("发送"))
    const next = onSend.mock.lastCall![0] as EditorReference[]
    expect(next.map((reference) => reference.ordinal)).toEqual([1, 2, 3])
    expect(next.slice(0, 2).map((reference) => reference.id)).toEqual(original.slice(1).map((reference) => reference.id))
    expect(original.map((reference) => reference.ordinal)).toEqual([1, 2, 3])
    fireEvent.click(screen.getByRole("button", { name: "清除全部引用" }))
    fireEvent.click(screen.getByText("添加第一条"))
    fireEvent.click(screen.getByText("发送"))
    expect(onSend.mock.lastCall![0]).toEqual([expect.objectContaining({ ordinal: 1 })])
  })

  it("renumbers remaining draft quotes after sending while keeping sent reference snapshots unchanged", () => {
    const onSend = vi.fn()
    render(<EditorReferencesProvider documentId="doc"><Harness onSend={onSend} /></EditorReferencesProvider>)
    for (const name of ["添加第一条", "添加第二条", "添加第三条"]) fireEvent.click(screen.getByText(name))
    fireEvent.click(screen.getByText("发送前两条"))
    const sent = onSend.mock.lastCall![0] as EditorReference[]
    fireEvent.click(screen.getByText("添加第一条"))
    fireEvent.click(screen.getByText("发送"))
    expect(onSend.mock.lastCall![0]).toEqual([
      expect.objectContaining({ ordinal: 1, text: "熟悉系统设计", comment: "检查表述" }),
      expect.objectContaining({ ordinal: 2, text: "负责需求分析", comment: "精简表达" }),
    ])
    expect(sent.map((reference) => reference.ordinal)).toEqual([1, 2])
  })
})
