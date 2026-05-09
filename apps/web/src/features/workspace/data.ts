import type { EvidenceCard, JobTarget, ReviewGateResult, TargetLanguage, UiLanguage, WorkspaceCopy } from "./types"
import type { ResumeDocJson } from "./editor"
import type { ResumeVersion } from "@typedance/contracts"

export const initialResumeText = [
  "张三",
  "全栈开发者",
  "",
  "负责 TypeDance 首版简历工作台的产品与工程落地。",
  "将简历编辑、岗位匹配、证据引用和 PDF 导出流程整合为可验证的本地优先工作流。",
  "与设计、工程和候选人反馈闭环协作，降低从目标岗位到可投递简历的整理成本。",
].join("\n")

export const jobTarget: JobTarget = {
  title: "全栈工程师",
  company: "B 端 AI 工具公司",
  salary: "30k-45k",
  experience: "3-5 年",
  keywords: ["React", "TypeScript", "本地优先", "AI 工作流", "PDF 导出", "证据链"],
  requirements: ["能独立交付复杂前端工作台", "理解权限、隐私和模型调用边界", "具备产品意识和工程落地能力"],
  matchScore: 82,
}

export const evidenceCards: EvidenceCard[] = [
  {
    id: "ev_resume_1",
    type: "resume",
    title: "旧简历：TypeDance 项目经历",
    excerpt: "负责简历工作台从需求拆解、交互验证到 React 前端实现。",
    confidence: "strong",
  },
  {
    id: "ev_project_2",
    type: "project_doc",
    title: "项目复盘：导出链路",
    excerpt: "记录 A4 预览、Review Gate、PDF 渲染状态和导出失败恢复策略。",
    confidence: "strong",
  },
  {
    id: "ev_manual_3",
    type: "manual_note",
    title: "手动补充：协作经验",
    excerpt: "跨设计、工程、候选人反馈推进首版闭环，但影响范围仍需量化。",
    confidence: "needs_confirmation",
  },
  {
    id: "ev_market_4",
    type: "external_background",
    title: "岗位语言参考",
    excerpt: "B 端 AI 工具更强调可信工作流、权限边界和可解释输出。",
    confidence: "inferred",
  },
]

export const resumeActions = [
  { command: "/tailor-resume", label: "按目标岗位优化" },
  { command: "/extract-evidence", label: "提取可引用证据" },
  { command: "/rewrite-bullet", label: "改写为结果导向 bullet" },
  { command: "/check-risk", label: "检查夸大与敏感风险" },
]

export const copy = {
  "zh-CN": {
    save: "保存版本",
    export: "导出 PDF",
    local: "本地优先",
    targetLanguage: "简历语言",
    job: "目标岗位",
    workspace: "工作台",
    jobs: "岗位",
    evidence: "证据",
    review: "检查",
    exports: "导出",
    settings: "设置",
    jobRailTitle: "目标岗位",
    jobRailDescription: "这份简历正在为当前岗位定制。岗位信息与证据来源分开呈现，避免把外部背景误认为个人经历。",
    requirements: "硬性要求",
    versions: "岗位版本",
    resumeCanvas: "Resume Canvas",
    resumeText: "简历正文",
    actionMenu: "简历动作",
    contextPreview: "Context Preview",
    previewTitle: "A4 预览",
    insights: "质量概览",
    reviewGate: "Review Gate",
    match: "岗位匹配",
    coverage: "证据覆盖",
    risk: "风险表达",
    suggestion: "AI 建议",
    accept: "接受",
    editAccept: "编辑后接受",
    rerun: "重新生成",
    reject: "拒绝",
    language: "界面语言",
    theme: "主题",
  },
  "en-US": {
    save: "Save version",
    export: "Export PDF",
    local: "Local first",
    targetLanguage: "Resume language",
    job: "Job Target",
    workspace: "Workspace",
    jobs: "Jobs",
    evidence: "Evidence",
    review: "Review",
    exports: "Exports",
    settings: "Settings",
    jobRailTitle: "Job Target",
    jobRailDescription: "This resume is tailored for the selected opportunity. Job context and personal evidence stay visually separate.",
    requirements: "Requirements",
    versions: "Job versions",
    resumeCanvas: "Resume Canvas",
    resumeText: "Resume text",
    actionMenu: "Resume actions",
    contextPreview: "Context Preview",
    previewTitle: "A4 Preview",
    insights: "Quality Overview",
    reviewGate: "Review Gate",
    match: "Job match",
    coverage: "Evidence coverage",
    risk: "Risk language",
    suggestion: "AI Suggestion",
    accept: "Accept",
    editAccept: "Edit then accept",
    rerun: "Regenerate",
    reject: "Reject",
    language: "UI language",
    theme: "Theme",
  },
} satisfies Record<UiLanguage, WorkspaceCopy>

export function makeDraftResume(
  snapshot: string,
  targetLanguage: TargetLanguage,
  docJson: ResumeDocJson = { type: "doc", content: [] }
): ResumeVersion {
  const now = new Date().toISOString()

  return {
    id: "draft",
    title: targetLanguage === "zh-CN" ? "我的目标岗位简历" : "Targeted Resume",
    job_target_id: "job_fullstack_ai_tools",
    target_language: targetLanguage,
    template_id: "classic-a4",
    doc_json: docJson,
    plain_text_snapshot: snapshot,
    source_refs: evidenceCards.filter((card) => card.type !== "external_background").map((card) => card.id),
    accepted_edit_ids: [],
    created_at: now,
    updated_at: now,
  }
}

export function computeReviewGate(text: string): ReviewGateResult {
  const blockers: string[] = []
  const warnings: string[] = []

  if (text.trim().length < 80) {
    blockers.push("简历正文过短，无法形成可投递版本")
  }

  if (!text.includes("TypeDance")) {
    warnings.push("当前版本缺少与目标岗位最强相关的项目关键词")
  }

  if (!/\d|首版|降低|整合|负责/.test(text)) {
    warnings.push("结果表达偏弱，建议补充范围、指标或责任边界")
  }

  if (evidenceCards.some((card) => card.confidence === "needs_confirmation")) {
    warnings.push("有 1 条证据需要用户确认后才能进入强背书链路")
  }

  return {
    status: blockers.length ? "blocked" : warnings.length ? "needs_review" : "ready",
    blockers,
    warnings,
  }
}
