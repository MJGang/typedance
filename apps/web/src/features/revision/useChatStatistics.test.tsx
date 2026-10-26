import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getConversationStatistics } from "@/agentHost"
import type { ConversationStatistics } from "@typedance/contracts"
import { useChatStatistics, statisticsRevision } from "./useChatStatistics"

vi.mock("@/agentHost", () => ({ getConversationStatistics: vi.fn() }))
const data = (turns: number, active = false) => ({ turns, activity: { runs: active ? 1 : 0 } }) as ConversationStatistics

describe("chat statistics lifecycle", () => {
  beforeEach(() => vi.resetAllMocks())
  afterEach(() => vi.useRealTimers())
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
  it("polls once per second during a call without new boundary events and stops at the terminal snapshot", async () => {
    vi.useFakeTimers()
    vi.mocked(getConversationStatistics).mockResolvedValueOnce(data(1, true)).mockResolvedValueOnce(data(2, true)).mockResolvedValueOnce(data(3))
    const view = renderHook(() => useChatStatistics("a", "a", "same"))
    await act(async () => {})
    expect(view.result.current.statistics?.turns).toBe(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(view.result.current.statistics?.turns).toBe(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(view.result.current.statistics?.turns).toBe(3)
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(getConversationStatistics).toHaveBeenCalledTimes(3)
    view.unmount()
  })
  it("aborts old polls when switching chats and never overlaps a slow request", async () => {
    vi.useFakeTimers()
    let old: (value: ConversationStatistics) => void = () => {}
    vi.mocked(getConversationStatistics).mockImplementationOnce(() => new Promise((resolve) => { old = resolve })).mockResolvedValueOnce(data(2))
    const view = renderHook(({ id }) => useChatStatistics("shared-scope", id, "1", true), { initialProps: { id: "a" } })
    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    expect(getConversationStatistics).toHaveBeenCalledTimes(1)
    const signal = vi.mocked(getConversationStatistics).mock.calls[0][1]!
    view.rerender({ id: "b" })
    expect(signal.aborted).toBe(true)
    await act(async () => old(data(99, true)))
    expect(view.result.current.statistics?.turns).toBe(2)
    view.unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(getConversationStatistics).toHaveBeenCalledTimes(2)
  })
  it("marks stale data on failure and retries until live data returns", async () => {
    vi.useFakeTimers()
    vi.mocked(getConversationStatistics).mockResolvedValueOnce(data(1, true)).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(data(2))
    const view = renderHook(() => useChatStatistics("a", "a", "1"))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(view.result.current).toMatchObject({ failed: true, statistics: { turns: 1 } })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(view.result.current).toMatchObject({ failed: false, statistics: { turns: 2 } })
    view.unmount()
  })
});
