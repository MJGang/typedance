import "@testing-library/jest-dom/vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { ConversationStatistics } from "@typedance/contracts"
import { ChatStatusBar } from "./ChatStatusBar"

describe("ChatStatusBar", () => {
  it("keeps unknown provider data distinct from zero and opens detail by keyboard focus", async () => {
    render(<ChatStatusBar statistics={null} failed={false} />)
    expect(screen.getByRole("button", { name: "Token 用量" })).toHaveTextContent("— tok")
    fireEvent.focus(screen.getByRole("button", { name: "上下文占用" }))
    expect(await screen.findByText("发送消息后显示上下文占用。")).toBeInTheDocument()
  })
  it("shows measured totals with estimated context breakdown and never rounds partial cache hits to 100%", async () => {
    const statistics: ConversationStatistics = { turns: 4, steps: 79, model_ms: 548000, tool_ms: 2371000, ttft_ms: 1000, tokens_per_second: 225,
      usage: { input_tokens: 9000, output_tokens: 1000, total_tokens: 10000, cache_read_tokens: 8999, cache_miss_tokens: 1, cache_hit_percent: 99.99, measured_calls: 2, unmeasured_calls: 1 },
      context: { input_tokens: 215000, output_tokens: 1000, limit_tokens: 1_000_000, budget_tokens: 64000, system_tokens: 1600, tool_tokens: 9300, conversation_tokens: 205100, estimated: false } }
    render(<ChatStatusBar statistics={statistics} failed={false} />)
    expect(screen.getByRole("button", { name: "会话统计" })).toHaveTextContent("4轮79步 · 225 tok/s")
    expect(screen.getByRole("button", { name: "Token 用量" })).toHaveTextContent("缓存 99%")
    expect(screen.getByRole("button", { name: "上下文占用" })).toHaveTextContent("22%")
    fireEvent.click(screen.getByRole("button", { name: "上下文占用" }))
    expect(await screen.findByText("216K / 1M")).toBeInTheDocument()
    expect(screen.getByText("总量来自最近一次模型回报；拆分为估算。")).toBeInTheDocument()
  })
})
