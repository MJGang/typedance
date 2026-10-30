import { invoke } from "@tauri-apps/api/core"
import { flushAllSourceCanvasSaves, retryAllSourceCanvasSaves } from "./features/revision/useSourceCanvasAutosave"
import { applyAccountState, getAccountView, lockAccountView, refreshAccountState, setAccountAction, type AccountProvider } from "./accountState"
import { captureAccountSession, pauseAccountWork, resumeAccountWork, setAccountSession } from "./accountSession"

let operation: Promise<void> | null = null

async function changeAccount(command: string, args?: Record<string, unknown>) {
  if (operation) return operation
  if (getAccountView().phase !== "idle") return
  if (getAccountView().state.status === "locking") {
    setAccountAction("idle", "请先保存当前资料，再重新登录。")
    return
  }
  operation = (async () => {
    const hasWorkspace = getAccountView().state.status === "ready"
    const captured = hasWorkspace ? captureAccountSession() : null
    setAccountAction(hasWorkspace ? "saving" : "switching")
    try {
      if (captured) await pauseAccountWork(captured)
      if (hasWorkspace && !await flushAllSourceCanvasSaves()) {
        throw new Error("有内容尚未保存，已保留当前工作区。请先重试保存，再退出或切换账号。")
      }
      setAccountAction("switching")
      setAccountSession(null)
      applyAccountState(await invoke(command, args))
      setAccountAction("idle")
    } catch (error) {
      if (captured && getAccountView().phase === "saving" && getAccountView().state.status === "ready") {
        try { await resumeAccountWork(captured) }
        catch { setAccountAction("idle", "AI 任务仍暂停，当前编辑内容已保留。请重试退出或切换账号。"); return }
      }
      // A failed save never calls the desktop transition or invalidates the old workspace.
      if (getAccountView().phase === "switching") {
        try { await refreshAccountState() } catch {
          lockAccountView("无法确认账号状态，工作区已锁定。请重新登录。")
          return
        }
      }
      setAccountAction("idle", error instanceof Error ? error.message : String(error))
    }
  })().finally(() => { operation = null })
  return operation
}

export function signInAccount(provider?: AccountProvider) {
  return changeAccount("sign_in_account", provider ? { provider } : undefined)
}
export function signOutAccount() { return changeAccount("sign_out_account") }
export function importLocalAccountData(source: string) { return changeAccount("import_local_account_data", { source }) }
export function skipLocalAccountData() { return changeAccount("skip_local_account_data") }

let updateSession: ReturnType<typeof captureAccountSession> | null = null

export async function prepareAccountUpdate(): Promise<boolean> {
  if (operation || getAccountView().phase !== "idle" || getAccountView().state.status === "locking") return false
  if (getAccountView().state.status !== "ready") return true
  const captured = captureAccountSession()
  setAccountAction("saving")
  try {
    await pauseAccountWork(captured)
    if (!await flushAllSourceCanvasSaves()) throw new Error("有内容尚未保存，未开始安装更新。")
    updateSession = captured
    setAccountAction("switching")
    return true
  } catch (error) {
    try { await resumeAccountWork(captured) } catch { /* 保留画布与保存能力，可重试退出。 */ }
    setAccountAction("idle", error instanceof Error ? error.message : "资料保存失败，未开始安装更新。")
    return false
  }
}

export async function finishAccountUpdate() {
  const captured = updateSession
  updateSession = null
  if (captured && getAccountView().state.status === "ready" && getAccountView().state.session?.id === captured.session.id) {
    try { await resumeAccountWork(captured) } catch { /* 安装器可能已停止进程，桌面状态事件将重新绑定会话。 */ }
  }
  setAccountAction("idle")
}

export async function finishAccountLock() {
  if (operation || getAccountView().state.status !== "locking") return
  setAccountAction("saving")
  operation = (async () => {
    try {
      if (!await retryAllSourceCanvasSaves()) throw new Error("当前内容尚未保存。请重试保存，资料保存完成后再重新登录。")
      applyAccountState(await invoke("finish_account_lock"))
      setAccountAction("idle")
    } catch (error) {
      setAccountAction("idle", error instanceof Error ? error.message : String(error))
    }
  })().finally(() => { operation = null })
  return operation
}

export async function cancelAccountSignIn() {
  try { applyAccountState(await invoke("cancel_account_sign_in")) }
  catch (error) { setAccountAction("idle", error instanceof Error ? error.message : String(error)) }
}

export async function openAccountCenter() {
  try { await invoke("open_account_center") }
  catch { setAccountAction("idle", "账号管理页面暂时无法打开，请稍后重试。") }
}
