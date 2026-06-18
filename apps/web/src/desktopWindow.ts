import { getCurrentWindow } from "@tauri-apps/api/window"
import { isTauri } from "@/tauri"

type DesktopWindowAction = "minimize" | "toggleMaximize" | "close" | "startDragging"

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
export const startDraggingDesktopWindow = () => runDesktopWindowAction("startDragging")
