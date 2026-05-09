import type { ThemePreference } from "./types"

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): "light" | "dark" {
  if (preference === "system") {
    return systemPrefersDark ? "dark" : "light"
  }

  return preference
}

export function getSavedPreference<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  const saved = window.localStorage.getItem(key)
  return allowed.includes(saved as T) ? (saved as T) : fallback
}

export function getSystemPrefersDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches
}
