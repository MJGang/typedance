from .revision_pack import DocumentPack, PackRegistry


resume_pack_definition = DocumentPack(
    id="resume",
    version="0.1.0",
    modules=[
        {
            "type": "BasicInfo",
            "title": "基本信息",
            "required": True,
            "repeatable": False,
            "default_visibility": "visible",
        },
        {
            "type": "CareerSummary",
            "title": "职业摘要",
            "required": False,
            "repeatable": False,
            "default_visibility": "visible",
        },
        {
            "type": "JobIntent",
            "title": "求职意向",
            "required": False,
            "repeatable": False,
            "default_visibility": "hidden",
        },
        {
            "type": "CoreSkills",
            "title": "核心技能",
            "required": False,
            "repeatable": False,
            "default_visibility": "visible",
        },
        {
            "type": "WorkExperience",
            "title": "工作经历",
            "required": False,
            "repeatable": True,
            "default_visibility": "visible",
        },
        {
            "type": "ProjectExperience",
            "title": "项目经历",
            "required": False,
            "repeatable": True,
            "default_visibility": "visible",
        },
        {
            "type": "Education",
            "title": "教育经历",
            "required": False,
            "repeatable": True,
            "default_visibility": "visible",
        },
        {
            "type": "InternshipExperience",
            "title": "实习经历",
            "required": False,
            "repeatable": True,
            "default_visibility": "visible",
        },
        {
            "type": "Certificates",
            "title": "证书",
            "required": False,
            "repeatable": True,
            "default_visibility": "visible",
        },
        {
            "type": "Awards",
            "title": "荣誉奖项",
            "required": False,
            "repeatable": True,
            "default_visibility": "visible",
        },
        {
            "type": "Portfolio",
            "title": "作品链接",
            "required": False,
            "repeatable": True,
            "default_visibility": "visible",
        },
        {
            "type": "SelfEvaluation",
            "title": "自我评价",
            "required": False,
            "repeatable": False,
            "default_visibility": "hidden",
        },
        {
            "type": "CustomModule",
            "title": "自定义模块",
            "required": False,
            "repeatable": True,
            "default_visibility": "visible",
        },
    ],
    issue_types=[
        {"type": "missing_info", "default_severity": "warning", "title": "信息缺失"},
        {"type": "vague_expression", "default_severity": "warning", "title": "表达空泛"},
        {"type": "missing_result", "default_severity": "warning", "title": "缺少结果"},
        {"type": "missing_evidence", "default_severity": "blocking", "title": "缺少证据"},
        {"type": "timeline_conflict", "default_severity": "blocking", "title": "时间线异常"},
        {
            "type": "skill_without_support",
            "default_severity": "warning",
            "title": "技能缺少经历支撑",
        },
        {"type": "duplicate_content", "default_severity": "info", "title": "内容重复"},
        {"type": "too_long", "default_severity": "warning", "title": "篇幅过长"},
        {
            "type": "tone_inconsistent",
            "default_severity": "info",
            "title": "语言风格不统一",
        },
        {
            "type": "hr_unfriendly",
            "default_severity": "warning",
            "title": "HR 阅读不友好",
        },
        {"type": "overclaim_risk", "default_severity": "blocking", "title": "夸大风险"},
        {"type": "layout_risk", "default_severity": "warning", "title": "排版风险"},
    ],
    actions=[
        {"action_type": "accept_proposal", "label": "接受修改"},
        {"action_type": "reject_proposal", "label": "保留原文"},
        {
            "action_type": "request_user_input",
            "label": "补充事实",
            "creates_run_type": "issue_action",
        },
        {
            "action_type": "make_more_conservative",
            "label": "改得更保守",
            "creates_run_type": "issue_action",
        },
        {
            "action_type": "make_more_specific",
            "label": "改得更具体",
            "creates_run_type": "issue_action",
        },
        {"action_type": "view_source", "label": "查看来源"},
        {"action_type": "dismiss_issue", "label": "忽略问题"},
        {"action_type": "confirm_claim", "label": "确认真实"},
    ],
    quality_rules=[
        {
            "id": "resume_contact_required",
            "description": "简历必须包含姓名和至少一种联系方式。",
            "severity": "blocking",
        },
        {
            "id": "resume_strong_claim_evidence",
            "description": "强成果主张必须有关联证据或用户确认。",
            "severity": "blocking",
        },
        {
            "id": "resume_vague_expression",
            "description": "核心经历不应只有空泛职责描述。",
            "severity": "warning",
        },
    ],
    evidence_rules=[
        {
            "id": "achievement_requires_evidence",
            "claim_type": "achievement",
            "requires_evidence": True,
            "requires_user_confirmation_when_missing": True,
        },
        {
            "id": "skill_prefers_evidence",
            "claim_type": "skill",
            "requires_evidence": True,
            "requires_user_confirmation_when_missing": False,
        },
        {
            "id": "summary_requires_support",
            "claim_type": "summary",
            "requires_evidence": True,
            "requires_user_confirmation_when_missing": True,
        },
    ],
    agent_contracts=[
        {
            "agent_name": "ParserAgent",
            "input_schema": "SourceDocument",
            "output_schema": "ParsedDocumentOutput",
        },
        {
            "agent_name": "ResumeStructurer",
            "input_schema": "ParsedBlock[]",
            "output_schema": "StructuredResumeOutput",
        },
        {
            "agent_name": "ResumeReviewer",
            "input_schema": "DraftVersion",
            "output_schema": "ResumeReviewOutput",
        },
        {
            "agent_name": "ResumeRewriter",
            "input_schema": "RevisionIssue",
            "output_schema": "ResumeRewriteOutput",
        },
        {
            "agent_name": "EvidenceVerifier",
            "input_schema": "DocumentClaim[]",
            "output_schema": "EvidenceVerificationOutput",
        },
        {
            "agent_name": "OpportunityCalibrator",
            "input_schema": "OpportunityContext",
            "output_schema": "OpportunityCalibrationOutput",
        },
        {
            "agent_name": "RenderPlanner",
            "input_schema": "DraftVersion",
            "output_schema": "RenderPlanOutput",
        },
        {
            "agent_name": "CoachNarrator",
            "input_schema": "WorkspaceView",
            "output_schema": "CoachNarrationOutput",
        },
    ],
    render_mapping={
        "default_profile": "default-a4",
        "supported_profiles": ["default-a4", "compact-a4", "ats"],
    },
)


def default_pack_registry() -> PackRegistry:
    return PackRegistry([resume_pack_definition])
