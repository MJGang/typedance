import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { version } from "../../../../../package.json"
import { isTauri } from "@/tauri"
import { finishAccountUpdate, prepareAccountUpdate } from "@/accountActions"

export type UpdatePhase = "idle" | "checking" | "latest" | "available" | "downloading" | "ready" | "installing" | "error"
export type UpdateFailure = "check" | "download" | "install" | "connection" | "unconfigured"
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
}

type UpdaterDependencies = {
  supported: boolean
  invoke: <T>(command: string) => Promise<T>
  listen: (callback: (snapshot: ClientUpdateSnapshot) => void) => Promise<() => void>
  storage: Pick<Storage, "getItem" | "setItem">
  prepareInstall: () => Promise<boolean>
  finishInstall: () => Promise<void>
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
    supported: dependencies.supported, autoCheck, preferenceError: false,
  }
  const listeners = new Set<() => void>()
  let subscription: Promise<() => void> | undefined
  let initialization: Promise<void> | undefined
  let operation: Promise<void> | undefined
  let started = false

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
          if (!await dependencies.prepareInstall()) throw new Error("资料尚未保存，未开始安装更新。")
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

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    async start() {
      if (started || !dependencies.supported) return
      started = true
      try {
        await initialize()
        if (snapshot.autoCheck && snapshot.phase === "idle") await run("check_client_update", "check")
      } catch {
        publish({ phase: "error", error: "connection" })
      }
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
  listen: (callback) => listen<ClientUpdateSnapshot>("client-update-state", (event) => callback(event.payload)),
  storage: {
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
  },
})
