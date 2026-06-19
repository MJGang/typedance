import { getCurrentWindow } from "@tauri-apps/api/window"
import { isTauri } from "@/tauri"

type DesktopWindowAction = "minimize" | "toggleMaximize" | "startDragging"

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
export const startDraggingDesktopWindow = () => runDesktopWindowAction("startDragging")

export async function closeDesktopWindow() {
  if (!isTauri()) return

  try {
    await window.__TAURI_INTERNALS__!.invoke("shutdown_application")
  } catch (error) {
    console.error("Failed to shut down desktop application:", error)
  }
}
