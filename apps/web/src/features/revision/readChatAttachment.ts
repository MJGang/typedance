import { harnessAttachmentSchema, type HarnessAttachment } from "@typedance/contracts"
import { extractAttachmentText } from "@/api"

export const attachmentAccept = ".png,.jpg,.jpeg,.webp,.gif,.pdf,.doc,.docx,.txt,.md,.markdown,.json,.jsonl,.csv,.tsv,.yaml,.yml,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.java,.rs,.go,.sql,.log,.toml,.ini,.sh,.ps1,.c,.cpp,.h"

export async function readChatAttachment(file: File, signal: AbortSignal): Promise<HarnessAttachment> {
  if (!file.size || file.size > 10 * 1024 * 1024) throw new Error(`${file.name}：文件须在 10 MB 以内且非空`)
  const isImage = /^image\/(png|jpeg|webp|gif)$/.test(file.type)
  const content = isImage ? { type: "image" as const, image_url: await imageDataUrl(file, signal) }
    : { type: "text" as const, text: await extractAttachmentText(file, signal) }
  const parsed = harnessAttachmentSchema.safeParse({ id: crypto.randomUUID(), name: file.name, mime_type: file.type || "application/octet-stream", size: file.size, content })
  if (!parsed.success) throw new Error(`${file.name}：图片过大或附件内容超限，请缩小后重试`)
  signal.throwIfAborted()
  return parsed.data
}

function imageDataUrl(file: File, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    const abort = () => reader.abort()
    const cleanup = () => signal.removeEventListener("abort", abort)
    reader.onload = () => { cleanup(); resolve(String(reader.result)) }
    reader.onerror = () => { cleanup(); reject(new Error("无法读取图片")) }
    reader.onabort = () => { cleanup(); reject(new DOMException("已取消", "AbortError")) }
    signal.addEventListener("abort", abort, { once: true })
    if (signal.aborted) { cleanup(); reject(signal.reason); return }
    reader.readAsDataURL(file)
  })
}
