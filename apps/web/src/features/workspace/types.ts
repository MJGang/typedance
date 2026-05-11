import type { ResumeVersion } from "@typedance/contracts"

export type UiLanguage = "zh-CN" | "en-US"
export type TargetLanguage = "zh-CN" | "en-US"
export type ThemePreference = "light" | "dark" | "system"
export type WorkspaceSection = "workspace" | "templates" | "jobs" | "evidence" | "review" | "exports"
export type RunState = "idle" | "waiting_user_confirmation" | "running" | "completed" | "failed_retryable"
export type ReviewGateStatus = "ready" | "needs_review" | "blocked"

export type JobTarget = {
  title: string
  company: string
  salary: string
  experience: string
  keywords: string[]
  requirements: string[]
  matchScore: number
}

export type EvidenceCard = {
  id: string
  type: "resume" | "project_doc" | "manual_note" | "external_background"
  title: string
  excerpt: string
  confidence: "strong" | "inferred" | "needs_confirmation"
}

export type WorkspaceCopy = Record<string, string>

export type ReviewGateResult = {
  status: ReviewGateStatus
  blockers: string[]
  warnings: string[]
}

export type WorkspaceState = {
  text: string
  savedResume: ResumeVersion | null
  status: string
  runState: RunState
  uiLanguage: UiLanguage
  targetLanguage: TargetLanguage
  themePreference: ThemePreference
  activeSection: WorkspaceSection
}
