import json
import os
from collections.abc import Callable, Mapping
from typing import Any, Literal

from pydantic import BaseModel, Field

from .llm_provider import build_chat_model, has_configured_llm_api_key
from .resume_agent_outputs import QualitySummary, ResumeReviewOutput, RevisionIssueDraft
from .revision_agent_runtime import AgentInvocationContext
from .revision_import_flow import METRIC_RE
from .revision_models import DocumentClaim, DocumentModule, EvidenceLink


REQUIRED_MODULE_TYPES = {
    "BasicInfo": "基本信息",
    "CoreSkills": "专业技能",
    "WorkExperience": "工作经历",
    "ProjectExperience": "项目经历",
}


class ResumeReviewerRunRequest(BaseModel):
    modules: list[DocumentModule] = Field(default_factory=list)
    claims: list[DocumentClaim] = Field(default_factory=list)
    evidence_links: list[EvidenceLink] = Field(default_factory=list)


ResumeReviewerMode = Literal["rule", "langchain", "auto"]
ResumeReviewerRunner = Callable[[AgentInvocationContext, ResumeReviewerRunRequest], dict[str, Any]]


class ResumeReviewerRunnerConfig(BaseModel):
    mode: ResumeReviewerMode = "rule"


class RuleBasedResumeReviewerRunner:
    def __call__(
        self,
        context: AgentInvocationContext,
        request: ResumeReviewerRunRequest,
    ) -> dict[str, Any]:
        issues = _build_issue_drafts(request)
        output = ResumeReviewOutput(issues=issues, quality_summary=_quality_summary(issues))
        return {
            "invocation_id": context.invocation_id,
            "run_id": context.run_id,
            "document_id": context.document_id,
            "pack_id": context.pack_id,
            "agent_name": context.agent_name,
            "output_type": "ResumeReviewOutput",
            "confidence": 0.82,
            "warnings": [],
            "payload": output.model_dump(),
            "output_refs": [],
        }


class LangChainResumeReviewerRunner:
    def __init__(self, model_factory: Callable[[], Any] = build_chat_model) -> None:
        self.model_factory = model_factory

    def __call__(
        self,
        context: AgentInvocationContext,
        request: ResumeReviewerRunRequest,
    ) -> dict[str, Any]:
        model = self.model_factory()
        structured_model = model.with_structured_output(ResumeReviewOutput)
        raw_output = structured_model.invoke(_messages(context, request))
        output = _coerce_review_output(raw_output)
        return {
            "invocation_id": context.invocation_id,
            "run_id": context.run_id,
            "document_id": context.document_id,
            "pack_id": context.pack_id,
            "agent_name": context.agent_name,
            "output_type": "ResumeReviewOutput",
            "confidence": 0.82,
            "warnings": [],
            "payload": output.model_dump(),
            "output_refs": [],
        }


def load_resume_reviewer_runner_config(
    environ: Mapping[str, str] | None = None,
) -> ResumeReviewerRunnerConfig:
    env = environ if environ is not None else os.environ
    mode = env.get("TYPEDANCE_RESUME_REVIEWER_MODE", "rule").strip().lower()
    if mode in {"rules", "deterministic", "local"}:
        mode = "rule"
    if mode not in {"rule", "langchain", "auto"}:
        raise ValueError(f"Unsupported resume reviewer runner mode: {mode}")
    return ResumeReviewerRunnerConfig(mode=mode)


def build_resume_reviewer_runner(
    environ: Mapping[str, str] | None = None,
    *,
    model_factory: Callable[[], Any] | None = None,
) -> ResumeReviewerRunner:
    env = environ if environ is not None else os.environ
    config = load_resume_reviewer_runner_config(env)
    if config.mode == "rule":
        return RuleBasedResumeReviewerRunner()
    if config.mode == "auto" and not has_configured_llm_api_key(env):
        return RuleBasedResumeReviewerRunner()

    factory = model_factory or (lambda: build_chat_model(environ=env))
    return LangChainResumeReviewerRunner(model_factory=factory)


def _messages(
    context: AgentInvocationContext,
    request: ResumeReviewerRunRequest,
) -> list[dict[str, str]]:
    payload = {
        "run_type": "quality_review",
        "document_id": context.document_id,
        "draft": {
            "modules": [module.model_dump() for module in request.modules],
            "claims": [claim.model_dump() for claim in request.claims],
            "evidence_links": [evidence.model_dump() for evidence in request.evidence_links],
        },
    }
    return [
        {
            "role": "system",
            "content": (
                "你是 TypeDance 的 ResumeReviewer。只输出 ResumeReviewOutput 结构化结果。"
                "你只能生成可定位、可处理的问题卡，不能直接改写最终简历。"
                "高风险事实、缺少证据、缺少结果、模块缺失和导出风险都必须进入 issues。"
            ),
        },
        {
            "role": "user",
            "content": json.dumps(payload, ensure_ascii=False),
        },
    ]


def _coerce_review_output(raw_output: Any) -> ResumeReviewOutput:
    if isinstance(raw_output, ResumeReviewOutput):
        return raw_output
    if isinstance(raw_output, BaseModel):
        return ResumeReviewOutput.model_validate(raw_output.model_dump())
    return ResumeReviewOutput.model_validate(raw_output)


def _build_issue_drafts(request: ResumeReviewerRunRequest) -> list[RevisionIssueDraft]:
    module_by_type = {module.type: module for module in request.modules if module.visibility == "visible"}
    module_by_id = {module.id: module for module in request.modules}
    evidence_by_claim = {evidence.claim_id: evidence for evidence in request.evidence_links}
    issues: list[RevisionIssueDraft] = []

    for module_type, title in REQUIRED_MODULE_TYPES.items():
        module = module_by_type.get(module_type)
        if module is None:
            issues.append(
                _issue_draft(
                    issue_type=f"missing_{_module_key(module_type)}",
                    severity="blocking" if module_type == "BasicInfo" else "warning",
                    title=f"{title}缺失",
                    message=f"当前草稿缺少{title}模块。",
                    reason="完整模块是基础简历质量检查的第一层。",
                )
            )
            continue

        if _module_empty(module):
            issues.append(
                _issue_draft(
                    issue_type=f"missing_{_module_key(module_type)}",
                    severity="warning",
                    title=f"{title}需要补充",
                    message=f"{title}模块已经存在，但内容还不足。",
                    reason="空模块无法支撑投递或导出。",
                    module_id=module.id,
                )
            )

    basic = module_by_type.get("BasicInfo")
    if basic is not None and (not basic.data.get("phone") or not basic.data.get("email")):
        issues.append(
            _issue_draft(
                issue_type="missing_contact",
                severity="warning",
                title="联系方式需要补齐",
                message="电话和邮箱至少需要补齐，方便投递后被联系。",
                reason="联系方式缺失会影响投递闭环。",
                module_id=basic.id,
            )
        )

    for claim in request.claims:
        module = module_by_id.get(claim.module_id)
        evidence = evidence_by_claim.get(claim.id)
        if claim.confidence == "unsupported" or claim.risk_flags:
            issues.append(
                _issue_draft(
                    issue_type="claim_needs_confirmation",
                    severity="blocking",
                    title="高风险事实需要确认",
                    message="这条表述缺少可靠证据，导出前需要用户确认。",
                    reason="系统不能替用户确认未证实的经历或成果。",
                    module_id=claim.module_id,
                    claim_id=claim.id,
                    original_text=claim.text,
                    evidence_link_refs=[evidence.id] if evidence else [],
                )
            )
            continue

        if claim.confidence == "inferred" and evidence is None:
            issues.append(
                _issue_draft(
                    issue_type="evidence_missing",
                    severity="warning",
                    title="证据不足",
                    message="这条表述来自推断，建议补充来源或用户确认。",
                    reason="可追溯证据能降低 AI 改写带来的失真风险。",
                    module_id=claim.module_id,
                    claim_id=claim.id,
                    original_text=claim.text,
                )
            )

        if module is not None and module.type in {"WorkExperience", "ProjectExperience"} and not METRIC_RE.search(claim.text):
            issues.append(
                _issue_draft(
                    issue_type="missing_result",
                    severity="warning",
                    title="经历缺少结果",
                    message="这条经历更像职责描述，还没有体现业务结果或影响范围。",
                    reason="结果和规模能让简历从“做过什么”变成“做成了什么”。",
                    module_id=claim.module_id,
                    claim_id=claim.id,
                    original_text=claim.text,
                    evidence_link_refs=[evidence.id] if evidence else [],
                )
            )

    return issues


def _issue_draft(
    *,
    issue_type: str,
    severity: str,
    title: str,
    message: str,
    reason: str,
    module_id: str | None = None,
    claim_id: str | None = None,
    original_text: str | None = None,
    evidence_link_refs: list[str] | None = None,
) -> RevisionIssueDraft:
    return RevisionIssueDraft(
        type=issue_type,
        severity=severity,
        title=title,
        message=message,
        reason=reason,
        target={
            "module_id": module_id,
            "claim_id": claim_id,
        },
        original_text=original_text,
        evidence_link_refs=evidence_link_refs or [],
    )


def _quality_summary(issues: list[RevisionIssueDraft]) -> QualitySummary:
    blocking_count = sum(1 for issue in issues if issue.severity == "blocking")
    warning_count = sum(1 for issue in issues if issue.severity == "warning")
    if blocking_count:
        status = "blocked"
    elif warning_count:
        status = "needs_review"
    else:
        status = "ready"
    return QualitySummary(
        status=status,
        blocking_count=blocking_count,
        warning_count=warning_count,
        summary=f"发现 {blocking_count} 个阻塞问题和 {warning_count} 个待优化问题。",
    )


def _module_empty(module: DocumentModule) -> bool:
    if module.type == "BasicInfo":
        return not any(module.data.get(key) for key in ("name", "phone", "email", "headline"))
    items = module.data.get("items")
    return not isinstance(items, list) or not any(items)


def _module_key(module_type: str) -> str:
    return {
        "BasicInfo": "basic_info",
        "CoreSkills": "skills",
        "WorkExperience": "work_experience",
        "ProjectExperience": "project_experience",
    }.get(module_type, module_type.lower())
