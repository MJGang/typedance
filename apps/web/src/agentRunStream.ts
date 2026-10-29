import { agentRunEventSchema, type AgentRun, type AgentRunEvent } from "@typedance/contracts"

type StreamOptions = {
  signal?: AbortSignal
  runId: string
  afterSequence: number
  fetchStream: (afterSequence: number, signal: AbortSignal) => Promise<Response>
  listEvents: (afterSequence: number) => Promise<AgentRunEvent[]>
  getRun: () => Promise<AgentRun>
}

const terminalTypes = new Set(["run_completed", "run_failed", "run_cancelled"])

/** One resumable subscription. Network failures never become execution failures. */
export class AgentRunEventSource extends EventTarget {
  onerror: ((event: Event) => void) | null = null
  #closed = false
  #controller = new AbortController()
  #timer: ReturnType<typeof setTimeout> | undefined
  #cursor: number
  #retryDelay = 500
  #abortSession = () => this.close()

  constructor(private options: StreamOptions) {
    super()
    this.#cursor = options.afterSequence
    options.signal?.addEventListener("abort", this.#abortSession, { once: true })
    if (options.signal?.aborted) this.close()
    queueMicrotask(() => void this.#connect())
  }

  close() {
    if (this.#closed) return
    this.#closed = true
    this.options.signal?.removeEventListener("abort", this.#abortSession)
    this.#controller.abort()
    clearTimeout(this.#timer)
  }

  #deliver(value: unknown) {
    if (this.#closed) return
    const event = agentRunEventSchema.parse(value)
    if (event.run_id !== this.options.runId) throw new Error("Unexpected run event")
    if (event.sequence <= this.#cursor) return
    this.#cursor = event.sequence
    this.dispatchEvent(new MessageEvent(event.type, { data: JSON.stringify(event) }))
    if (terminalTypes.has(event.type)) this.close()
  }

  async #connect() {
    if (this.#closed) return
    try {
      const response = await this.options.fetchStream(this.#cursor, this.#controller.signal)
      if (!response.ok || !response.body) throw new Error(`Event stream unavailable: ${response.status}`)
      this.dispatchEvent(new Event("open"))
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      try {
        while (!this.#closed) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          if (buffer.length > 1_048_576) throw new Error("Event stream frame is too large")
          const lines = buffer.split(/\r?\n/)
          buffer = lines.pop() ?? ""
          for (const line of lines) {
            if (line.startsWith("data:")) this.#deliver(JSON.parse(line.slice(5).trim()))
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined)
        reader.releaseLock()
      }
    } catch {
      // Reconcile against the server below, including a terminal event missed on disconnect.
    }
    if (this.#closed) return
    const error = new Event("error")
    this.dispatchEvent(error)
    this.onerror?.(error)
    try {
      const run = await this.options.getRun()
      if (this.#closed) return
      for (const event of await this.options.listEvents(this.#cursor)) this.#deliver(event)
      if (this.#closed) return
      if (run.status !== "running") this.#retryDelay = 500
    } catch { /* The server may be restarting. Keep the last acknowledged cursor. */ }
    if (this.#closed) return
    this.#timer = setTimeout(() => void this.#connect(), this.#retryDelay)
    this.#retryDelay = Math.min(this.#retryDelay * 2, 5_000)
  }
}
