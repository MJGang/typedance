import { z } from "zod";
import { documentPackSchema } from "./document-pack";

export const resumePackSchema = documentPackSchema.extend({
  id: z.literal("resume"),
});

export const resumePackDefinition = {
  id: "resume",
  version: "0.1.0",
  modules: [
    { type: "BasicInfo", title: "基本信息", required: true, repeatable: false, default_visibility: "visible" },
    { type: "CareerSummary", title: "职业摘要", required: false, repeatable: false, default_visibility: "visible" },
    { type: "JobIntent", title: "求职意向", required: false, repeatable: false, default_visibility: "hidden" },
    { type: "CoreSkills", title: "核心技能", required: false, repeatable: false, default_visibility: "visible" },
    { type: "WorkExperience", title: "工作经历", required: false, repeatable: true, default_visibility: "visible" },
    { type: "ProjectExperience", title: "项目经历", required: false, repeatable: true, default_visibility: "visible" },
    { type: "Education", title: "教育经历", required: false, repeatable: true, default_visibility: "visible" },
    { type: "InternshipExperience", title: "实习经历", required: false, repeatable: true, default_visibility: "visible" },
    { type: "Certificates", title: "证书", required: false, repeatable: true, default_visibility: "visible" },
    { type: "Awards", title: "荣誉奖项", required: false, repeatable: true, default_visibility: "visible" },
    { type: "Portfolio", title: "作品链接", required: false, repeatable: true, default_visibility: "visible" },
    { type: "SelfEvaluation", title: "自我评价", required: false, repeatable: false, default_visibility: "hidden" },
    { type: "CustomModule", title: "自定义模块", required: false, repeatable: true, default_visibility: "visible" },
  ],
  issue_types: [
    { type: "missing_info", default_severity: "warning", title: "信息缺失" },
    { type: "vague_expression", default_severity: "warning", title: "表达空泛" },
    { type: "missing_result", default_severity: "warning", title: "缺少结果" },
    { type: "missing_evidence", default_severity: "blocking", title: "缺少证据" },
    { type: "timeline_conflict", default_severity: "blocking", title: "时间线异常" },
    { type: "skill_without_support", default_severity: "warning", title: "技能缺少经历支撑" },
    { type: "duplicate_content", default_severity: "info", title: "内容重复" },
    { type: "too_long", default_severity: "warning", title: "篇幅过长" },
    { type: "tone_inconsistent", default_severity: "info", title: "语言风格不统一" },
    { type: "hr_unfriendly", default_severity: "warning", title: "HR 阅读不友好" },
    { type: "overclaim_risk", default_severity: "blocking", title: "夸大风险" },
    { type: "layout_risk", default_severity: "warning", title: "排版风险" },
  ],
  actions: [
    { action_type: "accept_proposal", label: "接受修改" },
    { action_type: "reject_proposal", label: "保留原文" },
    { action_type: "request_user_input", label: "补充事实" },
    { action_type: "make_more_conservative", label: "改得更保守" },
    { action_type: "make_more_specific", label: "改得更具体" },
    { action_type: "view_source", label: "查看来源" },
    { action_type: "dismiss_issue", label: "忽略问题" },
    { action_type: "confirm_claim", label: "确认真实" },
  ],
  quality_rules: [
    { id: "resume_contact_required", description: "简历必须包含姓名和至少一种联系方式。", severity: "blocking" },
    { id: "resume_strong_claim_evidence", description: "强成果主张必须有关联证据或用户确认。", severity: "blocking" },
    { id: "resume_vague_expression", description: "核心经历不应只有空泛职责描述。", severity: "warning" },
  ],
  evidence_rules: [
    { id: "achievement_requires_evidence", claim_type: "achievement", requires_evidence: true, requires_user_confirmation_when_missing: true },
    { id: "skill_prefers_evidence", claim_type: "skill", requires_evidence: true, requires_user_confirmation_when_missing: false },
    { id: "summary_requires_support", claim_type: "summary", requires_evidence: true, requires_user_confirmation_when_missing: true },
  ],
  render_mapping: {
    default_profile: "default-a4",
    supported_profiles: ["default-a4", "compact-a4", "ats"],
  },
} satisfies z.input<typeof resumePackSchema>;

export type ResumePack = z.infer<typeof resumePackSchema>;
