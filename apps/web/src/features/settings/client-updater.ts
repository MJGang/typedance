import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { version } from "../../../../../package.json"
import { isTauri } from "@/tauri"
import { finishAccountUpdate, prepareAccountUpdate } from "@/accountActions"
import { getAccountView, subscribeAccountView } from "@/accountState"

export type UpdatePhase = "idle" | "checking" | "latest" | "available" | "downloading" | "ready" | "installing" | "error"
export type UpdateFailure = "check" | "download" | "prepare" | "install" | "connection" | "unconfigured"
export type ClientUpdateSnapshot = {
  revision: number
  phase: UpdatePhase
  currentVersion: string
  releasesUrl: string | null
  update: { version: string; notes: string; publishedAt: string | null } | null
  downloadedBytes: number
  totalBytes: number | null
  lastCheckedAt: number | null
  error: UpdateFailure | null
}

type UpdaterSnapshot = ClientUpdateSnapshot & {
  supported: boolean
  autoCheck: boolean
  preferenceError: boolean
  automatic: boolean
  retrying: boolean
}

type UpdaterDependencies = {
  supported: boolean
  invoke: <T>(command: string) => Promise<T>
  listen: (callback: (snapshot: ClientUpdateSnapshot) => void) => Promise<() => void>
  storage: Pick<Storage, "getItem" | "setItem">
  prepareInstall: () => Promise<boolean>
  finishInstall: () => Promise<void>
  getAccountContext: () => "restoring" | "login" | "workspace"
  subscribeAccount: (listener: () => void) => () => void
}

const AUTO_CHECK_KEY = "typedance.client-updates.auto-check"

export function createClientUpdater(dependencies: UpdaterDependencies) {
  let autoCheck = true
  try {
    autoCheck = dependencies.storage.getItem(AUTO_CHECK_KEY) !== "false"
  } catch { /* 存储不可用时仍允许本次会话检查更新。 */ }

  let snapshot: UpdaterSnapshot = {
    revision: 0, phase: "idle", currentVersion: version, releasesUrl: null, update: null,
    downloadedBytes: 0, totalBytes: null, lastCheckedAt: null, error: null,
    supported: dependencies.supported, autoCheck, preferenceError: false, automatic: false, retrying: false,
  }
  const listeners = new Set<() => void>()
  let subscription: Promise<() => void> | undefined
  let initialization: Promise<void> | undefined
  let operation: Promise<void> | undefined
  let startup: Promise<void> | undefined
  let automaticUpdate: Promise<void> | undefined
  let accountContext: ReturnType<UpdaterDependencies["getAccountContext"]> | undefined

  function publish(patch: Partial<UpdaterSnapshot>) {
    snapshot = { ...snapshot, ...patch }
    listeners.forEach((listener) => listener())
  }

  function apply(next: ClientUpdateSnapshot) {
    // IPC 返回值可能晚于进度事件，旧快照不能覆盖新状态。
    if (next.revision >= snapshot.revision) publish(next)
  }

  function initialize(): Promise<void> {
    if (!dependencies.supported) return Promise.resolve()
    if (!initialization) {
      initialization = (async () => {
        subscription ??= dependencies.listen(apply).catch((error: unknown) => {
          subscription = undefined
          throw error
        })
        await subscription
        apply(await dependencies.invoke<ClientUpdateSnapshot>("get_client_update_state"))
      })().catch((error: unknown) => {
        initialization = undefined
        throw error
      })
    }
    return initialization
  }

  function run(command: string, error: UpdateFailure): Promise<void> {
    if (!dependencies.supported) return Promise.resolve()
    if (operation) return operation
    operation = (async () => {
      let installPrepared = false
      try {
        await initialize()
        if (command === "install_client_update") {
          if (!await dependencies.prepareInstall()) {
            publish({ phase: "error", error: "prepare" })
            return
          }
          installPrepared = true
        }
        apply(await dependencies.invoke<ClientUpdateSnapshot>(command))
      } catch (cause) {
        console.error(`Client updater ${command} failed`, cause)
        publish({ phase: "error", error })
      } finally {
        if (installPrepared) await dependencies.finishInstall()
      }
    })().finally(() => { operation = undefined })
    return operation
  }

  async function waitForNativeOperation() {
    await operation
    if (snapshot.phase !== "checking" && snapshot.phase !== "downloading") return
    // WebView 重载时原生下载仍可能在运行，继续消费同一份进度和结果。
    await new Promise<void>((resolve) => {
      const settled = () => {
        if (snapshot.phase === "checking" || snapshot.phase === "downloading") return
        listeners.delete(settled)
        resolve()
      }
      listeners.add(settled)
      settled()
    })
  }

  function startLoginUpdate(): Promise<void> {
    if (automaticUpdate) return automaticUpdate
    publish({ automatic: true })
    automaticUpdate = (async () => {
      for (let attempt = 0; attempt <= 3; attempt++) {
        await waitForNativeOperation()
        if (snapshot.phase === "error" && ["unconfigured", "prepare", "install"].includes(snapshot.error ?? "")) return
        if (snapshot.phase === "idle" || snapshot.phase === "latest" || (snapshot.phase === "error" && snapshot.error !== "download")) {
          await run("check_client_update", "check")
          await waitForNativeOperation()
        }
        if (snapshot.phase === "available" || (snapshot.phase === "error" && snapshot.error === "download")) {
          await run("download_client_update", "download")
          await waitForNativeOperation()
        }
        if (snapshot.phase === "ready") {
          await run("install_client_update", "install")
          return
        }
        if (snapshot.phase !== "error" || !["check", "download", "connection"].includes(snapshot.error ?? "") || attempt === 3) return
        publish({ retrying: true })
        await new Promise<void>((resolve) => setTimeout(resolve, [10_000, 30_000, 60_000][attempt]))
        publish({ retrying: false })
      }
    })().catch((cause: unknown) => {
      console.error("Automatic client update failed", cause)
      publish({ phase: "error", error: "connection", retrying: false })
    }).finally(() => {
      if (snapshot.phase !== "ready" && snapshot.phase !== "installing") publish({ automatic: false, retrying: false })
      automaticUpdate = undefined
    })
    return automaticUpdate
  }

  function updateForAccount(): Promise<void> {
    const context = dependencies.getAccountContext()
    const enteredLogin = context === "login" && accountContext !== "login"
    accountContext = context
    if (enteredLogin) return startLoginUpdate()
    if (context === "login") return automaticUpdate ?? Promise.resolve()
    if (context === "workspace" && snapshot.autoCheck && snapshot.phase === "idle") return run("check_client_update", "check")
    return Promise.resolve()
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    start(): Promise<void> {
      if (!dependencies.supported) return Promise.resolve()
      if (startup) return startup
      // 应用级订阅只安装一次；登录页卸载和进入工作台不会丢失本轮更新。
      dependencies.subscribeAccount(() => { void updateForAccount() })
      startup = (async () => {
        await initialize()
        await updateForAccount()
      })().catch(() => { publish({ phase: "error", error: "connection" }) })
      return startup
    },
    check: () => run("check_client_update", "check"),
    download: () => run("download_client_update", "download"),
    install: () => run("install_client_update", "install"),
    async cancel() {
      if (!dependencies.supported) return false
      try {
        await dependencies.invoke("cancel_client_update")
        return true
      } catch (error) {
        console.error("Unable to cancel update download", error)
        return false
      }
    },
    async openReleaseNotes() {
      try {
        await dependencies.invoke("open_client_update_logs")
        return true
      } catch {
        return false
      }
    },
    setAutoCheck(value: boolean) {
      try {
        dependencies.storage.setItem(AUTO_CHECK_KEY, String(value))
        publish({ autoCheck: value, preferenceError: false })
      } catch {
        publish({ autoCheck: value, preferenceError: true })
      }
    },
  }
}

export const clientUpdater = createClientUpdater({
  supported: isTauri(),
  invoke,
  prepareInstall: prepareAccountUpdate,
  finishInstall: finishAccountUpdate,
  getAccountContext: () => {
    const { status } = getAccountView().state
    if (status === "restoring") return "restoring"
    return status === "ready" || status === "locking" ? "workspace" : "login"
  },
  subscribeAccount: subscribeAccountView,
  listen: (callback) => listen<ClientUpdateSnapshot>("client-update-state", (event) => callback(event.payload)),
  storage: {
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
  },
})
