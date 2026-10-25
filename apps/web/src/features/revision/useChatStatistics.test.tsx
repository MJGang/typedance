import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { getConversationStatistics } from "@/agentHost"
import type { ConversationStatistics } from "@typedance/contracts"
import { useChatStatistics, statisticsRevision } from "./useChatStatistics"

vi.mock("@/agentHost", () => ({ getConversationStatistics: vi.fn() }))
const data = (turns: number) => ({ turns }) as ConversationStatistics

describe("chat statistics lifecycle", () => {
  beforeEach(() => vi.resetAllMocks())
  it("discards delayed responses after switching conversations or receiving a newer revision", async () => {
    let old: (value: ConversationStatistics) => void = () => {}
    vi.mocked(getConversationStatistics).mockImplementationOnce(() => new Promise((resolve) => { old = resolve }))
      .mockResolvedValueOnce(data(2)).mockResolvedValueOnce(data(3))
    const view = renderHook(({ scope, id, revision }) => useChatStatistics(scope, id, revision), { initialProps: { scope: "a", id: "a", revision: "1" } })
    view.rerender({ scope: "b", id: "b", revision: "1" })
    await waitFor(() => expect(view.result.current.statistics?.turns).toBe(2))
    await act(async () => old(data(99)))
    expect(view.result.current.statistics?.turns).toBe(2)
    view.rerender({ scope: "b", id: "b", revision: "2" })
    await waitFor(() => expect(view.result.current.statistics?.turns).toBe(3))
  })
  it("does not refresh metrics for every text delta", () => {
    const event = { id: "model", type: "harness_event", payload: { event: { type: "model.call.completed" } } } as never
    expect(statisticsRevision({ run: [event] })).toBe(statisticsRevision({ run: [event, { id: "delta", type: "assistant_delta", payload: {} } as never] }))
  })
});
