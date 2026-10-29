export type AccountSession = {
  id: string
  sidecar_url: string
  agent_host_url: string
  token: string
}

type Service = "sidecar" | "agent-host"

export class AccountSessionEndedError extends Error {
  constructor() {
    super("账号会话已结束，请在当前账号中重试。")
    this.name = "AccountSessionEndedError"
  }
}

export type CapturedAccountSession = {
  readonly session: AccountSession
  readonly epoch: number
  readonly signal: AbortSignal
  readonly activitySignal: AbortSignal
}

let active: CapturedAccountSession | null = null
let controller: AbortController | null = null
let activityController: AbortController | null = null
let activityCell: { controller: AbortController } | null = null
let epoch = 0
let saveOnly = false
const activityStopListeners = new Set<() => void>()
const activityResumeListeners = new Set<() => void>()

export function subscribeAccountActivitiesStopped(listener: () => void) {
  activityStopListeners.add(listener)
  return () => { activityStopListeners.delete(listener) }
}

export function subscribeAccountActivitiesResumed(listener: () => void) {
  activityResumeListeners.add(listener)
  return () => { activityResumeListeners.delete(listener) }
}

function stopAccountActivities() {
  activityController?.abort(new Error("账号活动已暂停"))
  for (const listener of activityStopListeners) listener()
}

export function setAccountSaveOnly(value: boolean) {
  if (value && !saveOnly) stopAccountActivities()
  const resumed = !value && saveOnly && active !== null && activityCell !== null
  if (resumed && activityCell) {
    activityController = new AbortController()
    activityCell.controller = activityController
  }
  saveOnly = value
  if (resumed) for (const listener of activityResumeListeners) listener()
}

/** Only the verified desktop state may publish a business session. */
export function setAccountSession(session: AccountSession | null) {
  if (active && session && active.session.id === session.id
    && active.session.token === session.token
    && active.session.sidecar_url === session.sidecar_url
    && active.session.agent_host_url === session.agent_host_url) return
  if (active) stopAccountActivities()
  controller?.abort(new AccountSessionEndedError())
  controller = null
  activityController = null
  activityCell = null
  active = null
  saveOnly = false
  if (session) {
    controller = new AbortController()
    activityController = new AbortController()
    const cell = { controller: activityController }
    activityCell = cell
    active = { session: { ...session }, epoch: ++epoch, signal: controller.signal, get activitySignal() { return cell.controller.signal } }
  }
}

export function captureAccountSession(): CapturedAccountSession {
  if (!active || active.signal.aborted) throw new AccountSessionEndedError()
  return active
}

/** Lifecycle calls retain the save capability while ordinary AI requests are paused. */
export async function pauseAccountWork(captured = captureAccountSession()) {
  setAccountSaveOnly(true)
  await lifecycleRequest("pause", captured)
}

export async function resumeAccountWork(captured = captureAccountSession()) {
  await lifecycleRequest("resume", captured)
  setAccountSaveOnly(false)
}

async function lifecycleRequest(action: "pause" | "resume", captured: CapturedAccountSession) {
  assertAccountSession(captured)
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(new Error("账号操作超时，请重试。")), 20_000)
  const linked = linkedAbortSignal(captured, timeout.signal)
  try {
    const response = await fetch(new URL(`/account/${action}`, captured.session.agent_host_url).href, {
      method: "POST", headers: { Authorization: `Bearer ${captured.session.token}` },
      signal: linked.signal, credentials: "omit", redirect: "error",
    })
    assertAccountSession(captured)
    if (!response.ok) throw new Error("AI 任务尚未安全暂停，请稍后重试。")
  } finally { clearTimeout(timer); linked.cleanup() }
}

export function assertAccountSession(captured: CapturedAccountSession) {
  if (captured !== active || captured.signal.aborted) throw new AccountSessionEndedError()
}

function linkedAbortSignal(captured: CapturedAccountSession, signal?: AbortSignal | null, activitySignal?: AbortSignal) {
  const requestController = new AbortController()
  const abortSession = () => requestController.abort(new AccountSessionEndedError())
  const abortRequest = () => requestController.abort(signal?.reason)
  const abortActivity = () => requestController.abort(activitySignal?.reason)
  captured.signal.addEventListener("abort", abortSession, { once: true })
  signal?.addEventListener("abort", abortRequest, { once: true })
  activitySignal?.addEventListener("abort", abortActivity, { once: true })
  if (captured.signal.aborted) abortSession()
  if (signal?.aborted) abortRequest()
  if (activitySignal?.aborted) abortActivity()
  return {
    signal: requestController.signal,
    cleanup() {
      captured.signal.removeEventListener("abort", abortSession)
      signal?.removeEventListener("abort", abortRequest)
      activitySignal?.removeEventListener("abort", abortActivity)
    },
  }
}

/** Guard body consumption as well as response headers, including mocked/delayed responses. */
function guardedResponse(response: Response, captured: CapturedAccountSession, cleanup: () => void): Response {
  let body: ReadableStream<Uint8Array> | null | undefined
  const bodyMethods = new Set(["json", "text", "blob", "arrayBuffer", "formData", "bytes"])
  return new Proxy(response, {
    get(target, property) {
      if (property === "clone") {
        return () => { assertAccountSession(captured); return guardedResponse(target.clone(), captured, cleanup) }
      }
      if (bodyMethods.has(String(property))) {
        return async (...args: unknown[]) => {
          assertAccountSession(captured)
          try {
            const value = await Reflect.get(target, property, target).apply(target, args)
            assertAccountSession(captured)
            return value
          } finally { cleanup() }
        }
      }
      if (property === "body") {
        if (body !== undefined) return body
        if (!target.body) { cleanup(); return null }
        const reader = target.body.getReader()
        body = new ReadableStream<Uint8Array>({
          async pull(streamController) {
            try {
              assertAccountSession(captured)
              const chunk = await reader.read()
              assertAccountSession(captured)
              if (chunk.done) { streamController.close(); cleanup() }
              else streamController.enqueue(chunk.value)
            } catch (error) {
              streamController.error(error)
              await reader.cancel(error).catch(() => undefined)
              cleanup()
            }
          },
          async cancel(reason) {
            try { await reader.cancel(reason) } finally { cleanup() }
          },
        })
        return body
      }
      const value = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}

export async function accountFetch(
  service: Service,
  path: string,
  init: RequestInit = {},
  captured = captureAccountSession(),
): Promise<Response> {
  assertAccountSession(captured)
  const method = init.method?.toUpperCase() ?? "GET"
  const saveOperation = service === "sidecar" && (
    (method === "PUT" && /^\/documents\/[^/]+\/source-resume-canvas$/.test(path))
    || (method === "GET" && path === "/editor/capabilities")
    || (method === "POST" && (path === "/editor/prepare" || /^\/documents\/[^/]+\/editor\/migrate-page-margins$/.test(path)))
  )
  if (saveOnly && !saveOperation) {
    throw new Error("账号正在锁定，请先完成资料保存。")
  }
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("无效的本机服务路径")
  const base = service === "sidecar" ? captured.session.sidecar_url : captured.session.agent_host_url
  const url = new URL(path, `${base.replace(/\/$/, "")}/`)
  if (url.origin !== new URL(base).origin) throw new Error("本机服务地址不匹配")
  const headers = new Headers(init.headers)
  headers.set("authorization", `Bearer ${captured.session.token}`)
  const linked = linkedAbortSignal(captured, init.signal, service === "agent-host" ? captured.activitySignal : undefined)
  try {
    const response = await fetch(url.href, { ...init, headers, signal: linked.signal, credentials: "omit", redirect: "error" })
    assertAccountSession(captured)
    if (!response.body) linked.cleanup()
    return guardedResponse(response, captured, linked.cleanup)
  } catch (error) {
    linked.cleanup()
    assertAccountSession(captured)
    throw error
  }
}

export function sidecarFetch(path: string, init?: RequestInit, captured?: CapturedAccountSession) {
  return accountFetch("sidecar", path, init, captured)
}

export function agentHostFetch(path: string, init?: RequestInit, captured?: CapturedAccountSession) {
  return accountFetch("agent-host", path, init, captured)
}

export function accountObjectUrl(blob: Blob, captured = captureAccountSession()) {
  assertAccountSession(captured)
  const url = URL.createObjectURL(blob)
  captured.signal.addEventListener("abort", () => URL.revokeObjectURL(url), { once: true })
  return url
}
