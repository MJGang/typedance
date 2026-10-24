export type MicrophoneChoice = { id: string; label: string }
const preferenceKey = "typedance.voice.microphone.v1"

export function getMicrophoneChoice(): MicrophoneChoice {
  try {
    const stored = localStorage.getItem(preferenceKey)
    if (stored) {
      const value: unknown = JSON.parse(stored)
      if (value && typeof value === "object" && "id" in value && typeof value.id === "string" && value.id.length <= 4096
        && "label" in value && typeof value.label === "string" && value.label.length <= 2048) return { id: value.id, label: value.label }
    }
  } catch { /* Unavailable storage must not prevent using the system microphone. */ }
  return { id: "", label: "" }
}

export function saveMicrophoneChoice(choice: MicrophoneChoice): void {
  localStorage.setItem(preferenceKey, JSON.stringify(choice))
}

export function microphoneConstraints(choice = getMicrophoneChoice()): MediaStreamConstraints {
  return { audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true,
    ...(choice.id ? { deviceId: { exact: choice.id } } : {}) }, video: false }
}

export function microphoneFailureMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") return "麦克风权限被拒绝，请在系统设置中允许 TypeDance 使用麦克风"
    if (error.name === "NotFoundError" || error.name === "OverconstrainedError") return "所选麦克风已不可用，请在设置 → 语音输入中重新选择录音设备"
    if (error.name === "NotReadableError" || error.name === "AbortError") return "麦克风暂时无法使用，请检查设备连接或占用后重试"
  }
  return error instanceof Error ? error.message : "无法打开麦克风"
}
