import "@testing-library/jest-dom/vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AgentRunEvent, HarnessRunEvent } from "@typedance/contracts"
import { AgentInteraction } from "./AgentInteraction"

const respond = vi.hoisted(() => vi.fn())
vi.mock("@/agentHost", () => ({ respondToAgentInteraction: respond }))
const base = { id: "event", run_id: "run", sequence: 0, created_at: "2026-10-24T00:00:00Z" }
const question: HarnessRunEvent = { ...base, type: "user.questions.requested", request_id: "q", questions: [{ id: "role", header: "目标岗位", question: "希望投递什么岗位？" }] }
const wrap = (event: HarnessRunEvent): AgentRunEvent => ({ ...base, id: event.id, type: "harness_event", payload: { event } })

describe("Agent interactions", () => {
  beforeEach(() => { respond.mockReset(); respond.mockResolvedValue(undefined) })
  it("requires an actual answer and preserves it when submission fails", async () => {
    respond.mockRejectedValueOnce(new Error("network failed"))
    render(<AgentInteraction runId="run" event={question} events={[wrap(question)]} active />)
    expect(screen.getByRole("button", { name: "提交回答" })).toBeDisabled()
    fireEvent.change(screen.getByRole("textbox", { name: "你的回答" }), { target: { value: "全栈工程师" } })
    fireEvent.click(screen.getByRole("button", { name: "提交回答" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("network failed")
    expect(screen.getByRole("textbox")).toHaveValue("全栈工程师")
    fireEvent.click(screen.getByRole("button", { name: "提交回答" }))
    await waitFor(() => expect(respond).toHaveBeenLastCalledWith("run", "questions", "q", { answers: { role: "全栈工程师" } }))
    expect(await screen.findByText("已回答")).toBeInTheDocument()
  })
  it("restores a submitted answer from events and disables ended requests", () => {
    const answered: HarnessRunEvent = { ...base, id: "answered", sequence: 1, type: "user.questions.answered", request_id: "q", answers: { role: "前端" } }
    render(<AgentInteraction runId="run" event={question} events={[wrap(question), wrap(answered)]} active={false} />)
    expect(screen.getByRole("textbox")).toHaveValue("前端")
    expect(screen.getByRole("textbox")).toBeDisabled()
    expect(screen.queryByRole("button", { name: "提交回答" })).not.toBeInTheDocument()
  })

  it("submits a single scoped denial and restores the decision from events", async () => {
    const request: HarnessRunEvent = { ...base, type: "permission.requested", request: { id: "permission", run_id: "run", kind: "filesystem.write", reason: "需要确认本次写入", scope: { uri: "test://file", access: "write" }, created_at: base.created_at } }
    const { rerender } = render(<AgentInteraction runId="run" event={request} events={[wrap(request)]} active />)
    fireEvent.click(screen.getByRole("button", { name: "拒绝" }))
    await waitFor(() => expect(respond).toHaveBeenCalledWith("run", "permissions", "permission", { status: "denied" }))
    expect(await screen.findByText("已提交决定")).toBeInTheDocument()
    const resolved: HarnessRunEvent = { ...base, id: "decision", sequence: 1, type: "permission.resolved", decision: { id: "d", request_id: "permission", status: "denied", remember: "never", created_at: base.created_at } }
    rerender(<AgentInteraction runId="run" event={request} events={[wrap(request), wrap(resolved)]} active />)
    expect(screen.getByText("已拒绝")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "允许本次" })).not.toBeInTheDocument()
  })
})
