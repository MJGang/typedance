/**
 * Tauri runtime detection and IPC helpers.
 * Uses duck-typing to detect __TAURI_INTERNALS__ rather than @tauri-apps/api
 * to keep the Tauri dependency optional (pure web fallback).
 */

interface TauriInvoke {
  (cmd: string, args?: Record<string, unknown>): Promise<unknown>;
}

interface TauriInternals {
  invoke: TauriInvoke;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: TauriInternals;
  }
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;
}

