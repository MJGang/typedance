/**
 * Tauri runtime detection and IPC helpers.
 * Uses duck-typing to detect __TAURI_INTERNALS__ rather than @tauri-apps/api
 * to keep the Tauri dependency optional (pure web fallback).
 */

import { open, save } from "@tauri-apps/plugin-dialog";

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

export async function choosePdfSavePathInTauri(suggestedName: string): Promise<string | null> {
  if (!isTauri()) return null;
  return save({
    defaultPath: suggestedName,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
}

export async function chooseHtmlSavePathInTauri(suggestedName: string): Promise<string | null> {
  if (!isTauri()) return null;
  return save({
    defaultPath: suggestedName,
    filters: [{ name: "HTML", extensions: ["html", "htm"] }],
  });
}

export async function chooseContextFilePathsInTauri(): Promise<string[]> {
  if (!isTauri()) return [];
  const selected = await open({
    multiple: true,
    directory: false,
  });
  if (!selected) return [];
  return Array.isArray(selected) ? selected : [selected];
}

export async function chooseContextDirectoryPathInTauri(): Promise<string | null> {
  if (!isTauri()) return null;
  const selected = await open({
    multiple: false,
    directory: true,
  });
  return typeof selected === "string" ? selected : null;
}

/** 在 Tauri 桌面端用系统默认程序打开文件（使用 Opener 插件） */
export async function openFileInTauri(filePath: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await window.__TAURI_INTERNALS__!.invoke("open_exported_pdf", { filePath });
  } catch (err) {
    console.error("Failed to open file in Tauri:", err);
  }
}

/** 在文件管理器中显示文件所在位置 */
export async function revealFileInDir(filePath: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await window.__TAURI_INTERNALS__!.invoke("plugin:opener|reveal_item_in_dir", { path: filePath });
  } catch (err) {
    console.error("Failed to reveal file in Tauri:", err);
  }
}
