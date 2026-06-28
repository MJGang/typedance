import { getCurrentWindow } from "@tauri-apps/api/window"
import { isTauri } from "@/tauri"

type DesktopWindowAction = "minimize" | "toggleMaximize"

async function runDesktopWindowAction(action: DesktopWindowAction) {
  if (!isTauri()) return

  try {
    await getCurrentWindow()[action]()
  } catch (error) {
    console.error(`Failed to ${action} desktop window:`, error)
  }
}

export const minimizeDesktopWindow = () => runDesktopWindowAction("minimize")
export const toggleMaximizeDesktopWindow = () => runDesktopWindowAction("toggleMaximize")

export async function subscribeDesktopWindowMaximized(listener: (maximized: boolean) => void) {
  if (!isTauri()) return () => {}

  const currentWindow = getCurrentWindow()
  const refresh = async () => {
    try {
      listener(await currentWindow.isMaximized())
    } catch (error) {
      console.error("Failed to read desktop window maximized state:", error)
    }
  }

  try {
    const unsubscribe = await currentWindow.onResized(() => {
      void refresh()
    })
    await refresh()
    return unsubscribe
  } catch (error) {
    console.error("Failed to subscribe to desktop window resize events:", error)
    return () => {}
  }
}

export async function closeDesktopWindow() {
  if (!isTauri()) return

  try {
    await window.__TAURI_INTERNALS__!.invoke("shutdown_application")
  } catch (error) {
    console.error("Failed to shut down desktop application:", error)
  }
}
