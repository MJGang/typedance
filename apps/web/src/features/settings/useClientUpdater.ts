import { useEffect, useSyncExternalStore } from "react"
import { clientUpdater } from "./client-updater"

export function useClientUpdater() {
  return useSyncExternalStore(clientUpdater.subscribe, clientUpdater.getSnapshot)
}

export function ClientUpdateStartup() {
  useEffect(() => { void clientUpdater.start() }, [])
  return null
}
