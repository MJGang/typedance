import type { SourceResumeCanvas } from "@typedance/contracts"
import { migrateEditorPageMargins } from "@/api"
import { clampPageMargins, isPageMargins, pageMarginStorageKey, SOURCE_CANVAS_PAGE_SIZE } from "./pageMargins"

/** 一次性数据迁移：成功写入画布后删除旧键；编辑器不再读取旧存储。 */
export async function migratePageMargins(canvas: SourceResumeCanvas): Promise<SourceResumeCanvas> {
  const key = pageMarginStorageKey(canvas.document_id)
  const raw = localStorage.getItem(key)
  if (raw === null) return canvas
  let margins: unknown
  try { margins = JSON.parse(raw) } catch { margins = null }
  // 无效旧值同样先在后端原样备份，再结束迁移；不能阻止用户打开现有简历。
  const migrated = await migrateEditorPageMargins(canvas.document_id, isPageMargins(margins) ? clampPageMargins(margins, SOURCE_CANVAS_PAGE_SIZE) : null, raw)
  localStorage.removeItem(key)
  return migrated
}
