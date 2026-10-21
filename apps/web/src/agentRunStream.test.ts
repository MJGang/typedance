import { afterEach, describe, expect, it, vi } from "vitest"
import type { AgentRun, AgentRunEvent } from "@typedance/contracts"
import { AgentRunEventSource } from "./agentRunStream"

const sources: AgentRunEventSource[] = []
afterEach(() => { sources.splice(0).forEach((source) => source.close()); vi.useRealTimers() })
function event(sequence: number, type: AgentRunEvent["type"] = "assistant_delta"): AgentRunEvent {
  return { id: `event-${sequence}`, run_id: "run", sequence, type, payload: { delta: String(sequence) }, created_at: "2026-10-21T00:00:00.000Z" }
}
function response(events: AgentRunEvent[]) {
  return new Response(events.map((value) => `event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`).join(""))
}
const run: AgentRun = { id: "run", conversation_id: "conv", assistant_message_id: "msg", status: "running", mutation_mode: "review", started_at: "2026-10-21T00:00:00.000Z" }

describe("resumable run stream", () => {
  it("reconciles missed events then reconnects after the acknowledged sequence without duplicates", async () => {
    const fetchStream = vi.fn().mockResolvedValueOnce(response([event(0)]))
      .mockResolvedValueOnce(response([event(1), event(2), event(3, "run_completed")]))
    const getRun = vi.fn().mockResolvedValue(run)
    const listEvents = vi.fn().mockResolvedValue([event(0), event(1)])
    const source = new AgentRunEventSource({ runId: "run", afterSequence: -1, fetchStream, getRun, listEvents }); sources.push(source)
    const sequences: number[] = []
    source.addEventListener("assistant_delta", (value) => sequences.push(JSON.parse((value as MessageEvent).data).sequence))
    const completed = new Promise<void>((resolve) => source.addEventListener("run_completed", () => resolve()))
    await completed
    expect(sequences).toEqual([0, 1, 2])
    expect(listEvents).toHaveBeenCalledWith(0)
    expect(fetchStream.mock.calls.map((call) => call[0])).toEqual([-1, 1])
  })

  it("uses the persisted terminal event after a disconnect and stops retrying", async () => {
    const fetchStream = vi.fn().mockRejectedValue(new Error("disconnected"))
    const source = new AgentRunEventSource({ runId: "run", afterSequence: 4, fetchStream,
      getRun: async () => ({ ...run, status: "cancelled" }), listEvents: async () => [event(5, "run_cancelled")] }); sources.push(source)
    const received = new Promise<void>((resolve) => source.addEventListener("run_cancelled", () => resolve()))
    await received
    expect(fetchStream).toHaveBeenCalledOnce()
  })

  it("parses UTF8 frames split across network chunks", async () => {
    const frame = new TextEncoder().encode(`data: ${JSON.stringify({ ...event(0), payload: { delta: "中文" } })}\n\ndata: ${JSON.stringify(event(1, "run_completed"))}\n\n`)
    const body = new ReadableStream({ start(controller) { for (let i = 0; i < frame.length; i += 7) controller.enqueue(frame.slice(i, i + 7)); controller.close() } })
    const source = new AgentRunEventSource({ runId: "run", afterSequence: -1, fetchStream: async () => new Response(body), getRun: async () => run, listEvents: async () => [] }); sources.push(source)
    const deltas: string[] = []
    source.addEventListener("assistant_delta", (value) => deltas.push(JSON.parse((value as MessageEvent).data).payload.delta))
    await new Promise<void>((resolve) => source.addEventListener("run_completed", () => resolve()))
    expect(deltas).toEqual(["中文"])
  })

  it("aborts an unmounted subscription without scheduling retries", async () => {
    vi.useFakeTimers()
    const fetchStream = vi.fn((_after, signal: AbortSignal) => new Promise<Response>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })))
    const source = new AgentRunEventSource({ runId: "run", afterSequence: -1, fetchStream, getRun: async () => run, listEvents: async () => [] }); sources.push(source)
    await Promise.resolve()
    source.close()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchStream).toHaveBeenCalledOnce()
    expect(fetchStream.mock.calls[0][1].aborted).toBe(true)
  })
});
