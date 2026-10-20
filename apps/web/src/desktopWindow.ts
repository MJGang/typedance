import { getCurrentWindow } from "@tauri-apps/api/window"
import { isTauri } from "@/tauri"

type DesktopWindowAction = "close" | "minimize" | "toggleMaximize"

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
export const closeDesktopWindow = () => runDesktopWindowAction("close")

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
