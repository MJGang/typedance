const listeners = new Set<() => void>()

export function subscribeModelSettings(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function notifyModelSettingsChanged() {
  for (const listener of listeners) listener()
}
