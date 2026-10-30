import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { z } from "zod"
import { isTauri } from "./tauri"
import { setAccountSaveOnly, setAccountSession } from "./accountSession"

export const accountProviderSchema = z.enum(["github", "google", "wechat"])
export type AccountProvider = z.infer<typeof accountProviderSchema>

const localServiceUrl = z.string().url().refine((value) => {
  const url = new URL(value)
  return url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname)
    && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash
}, "无效的本机服务地址")

export const accountStateSchema = z.object({
  revision: z.number().int().nonnegative(),
  status: z.enum(["unconfigured", "restoring", "signed_out", "signing_in", "needs_import", "ready", "locking", "locked", "error"]),
  configured: z.boolean(),
  providers: z.array(accountProviderSchema),
  user: z.object({ id: z.string().min(1), name: z.string(), email: z.string().optional(), avatar: z.string().optional() }).nullable(),
  session: z.object({ id: z.string().min(1), sidecar_url: localServiceUrl, agent_host_url: localServiceUrl, token: z.string().min(32) }).nullable(),
  error: z.string().nullable(),
  legacy: z.object({ import_started: z.boolean(), sources: z.array(z.object({
    id: z.string().min(1), path: z.string().min(1), file_count: z.number().int().nonnegative(),
  })).min(1) }).nullable(),
}).superRefine((state, context) => {
  if ((state.status === "ready" || state.status === "locking") && (!state.user || !state.session)) {
    context.addIssue({ code: "custom", message: "已登录账号缺少有效会话" })
  }
  if (state.status !== "ready" && state.status !== "locking" && state.session) {
    context.addIssue({ code: "custom", message: "当前状态不允许访问账号资料" })
  }
  if (state.status === "needs_import" && (!state.user || !state.legacy)) {
    context.addIssue({ code: "custom", message: "历史数据导入缺少已验证账号或数据来源" })
  }
})

export type AccountState = z.infer<typeof accountStateSchema>
export type AccountView = { state: AccountState; phase: "idle" | "saving" | "switching"; actionError: string | null }

const initialState: AccountState = {
  revision: 0, status: "restoring", configured: false, providers: [],
  user: null, session: null, error: null, legacy: null,
}
let view: AccountView = { state: initialState, phase: "idle", actionError: null }
const listeners = new Set<() => void>()

export function getAccountView() { return view }
export function subscribeAccountView(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
function publish() { for (const listener of listeners) listener() }

export function applyAccountState(value: unknown) {
  const state = accountStateSchema.parse(value)
  if (state.revision < view.state.revision) return
  setAccountSession(state.status === "ready" || state.status === "locking" ? state.session : null)
  setAccountSaveOnly(state.status === "locking")
  view = { ...view, state }
  publish()
}

export function setAccountAction(phase: AccountView["phase"], actionError: string | null = null) {
  view = { ...view, phase, actionError }
  publish()
}

export function lockAccountView(message: string) {
  setAccountSession(null)
  view = { state: { ...view.state, status: "error", session: null, error: message }, phase: "idle", actionError: message }
  publish()
}

export async function refreshAccountState() {
  applyAccountState(await invoke("get_account_state"))
}

export function connectAccountState() {
  let disposed = false
  let unlisten: (() => void) | undefined
  if (!isTauri()) {
    applyAccountState({ ...initialState, status: "unconfigured", error: "请使用 TypeDance 桌面客户端登录。" })
    return () => {}
  }
  void (async () => {
    try {
      const cleanup = await listen<unknown>("typedance-account-changed", (event) => {
        if (!disposed) applyAccountState(event.payload)
      })
      if (disposed) { cleanup(); return }
      unlisten = cleanup
      const state = await invoke("get_account_state")
      if (!disposed) applyAccountState(state)
    } catch {
      if (!disposed) {
        setAccountSession(null)
        view = { state: { ...initialState, revision: view.state.revision, status: "error", error: "账号状态加载失败，请重试。" }, phase: "idle", actionError: null }
        publish()
      }
    }
  })()
  return () => { disposed = true; unlisten?.() }
}
