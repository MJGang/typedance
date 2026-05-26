import re
from collections.abc import Callable
from typing import Any

from pydantic import BaseModel, Field

from .resume_agent_outputs import (
    DraftVariantPlan,
    MatchSummary,
    OpportunityCalibrationOutput,
    OpportunityRequirement,
    RevisionIssueDraft,
    RevisionProposalDraft,
)
from .revision_agent_runtime import AgentInvocationContext
from .revision_models import DocumentClaim, DocumentModule


STOPWORDS = {
    "要求",
    "岗位",
    "职责",
    "负责",
    "熟悉",
    "具备",
    "优先",
    "相关",
    "经验",
    "能力",
    "以上",
    "开发",
    "工程师",
}


class OpportunityCalibratorRunRequest(BaseModel):
    source_title: str = Field(min_length=1)
    source_text: str = Field(min_length=1)
    base_draft_id: str = Field(min_length=1)
    variant_draft_id: str = Field(min_length=1)
    modules: list[DocumentModule] = Field(default_factory=list)
    claims: list[DocumentClaim] = Field(default_factory=list)


OpportunityCalibratorRunner = Callable[[AgentInvocationContext, OpportunityCalibratorRunRequest], dict[str, Any]]


class RuleBasedOpportunityCalibratorRunner:
    def __call__(
        self,
        context: AgentInvocationContext,
        request: OpportunityCalibratorRunRequest,
    ) -> dict[str, Any]:
        requirements = _opportunity_requirements(request)
        issues = _issue_drafts(request, requirements)
        proposals = _proposal_drafts(issues)
        output = OpportunityCalibrationOutput(
            opportunity_requirements=requirements,
            match_summary=_match_summary(requirements),
            issues=issues,
            proposals=proposals,
            variant_plan=DraftVariantPlan(
                title=f"{request.source_title}岗位版本",
                base_draft_ref=f"DraftVersion:{request.base_draft_id}",
                proposal_refs=[],
                risk_notes=[issue.message for issue in issues if issue.type == "overfit_risk"],
            ),
        )
        return {
            "invocation_id": context.invocation_id,
            "run_id": context.run_id,
            "document_id": context.document_id,
            "pack_id": context.pack_id,
            "agent_name": context.agent_name,
            "output_type": "OpportunityCalibrationOutput",
            "confidence": 0.78,
            "warnings": [],
            "payload": output.model_dump(),
            "output_refs": [],
        }


def _opportunity_requirements(request: OpportunityCalibratorRunRequest) -> list[OpportunityRequirement]:
    base_text = _base_text(request).lower()
    requirements = []
    for text in _requirement_tokens(request.source_text):
        requirements.append(
            OpportunityRequirement(
                type=_requirement_type(text),
                text=text,
                importance="required",
                evidence_status="matched" if text.lower() in base_text else "missing",
            )
        )
    return requirements


def _issue_drafts(
    request: OpportunityCalibratorRunRequest,
    requirements: list[OpportunityRequirement],
) -> list[RevisionIssueDraft]:
    missing = [requirement for requirement in requirements if requirement.evidence_status == "missing"]
    target_module_id = next((module.id for module in request.modules if module.type == "CoreSkills"), None)
    issues = [
        RevisionIssueDraft(
            type="missing_opportunity_requirement",
            severity="warning",
            title=f"岗位要求未匹配：{requirement.text}",
            message="基础简历中没有找到这项岗位要求的可靠表述。",
            reason="岗位版本只能基于用户已有事实生成，缺口需要补充证据后再写入。",
            target={"module_id": target_module_id},
            evidence_link_refs=[],
            action_templates=[],
        )
        for requirement in missing[:6]
    ]
    if len(missing) >= 3:
        issues.append(
            RevisionIssueDraft(
                type="overfit_risk",
                severity="warning",
                title="存在过度贴合岗位的风险",
                message="岗位要求中有多项无法从基础简历中得到支持，不应直接写进经历。",
                reason="系统不能为了匹配 JD 而虚构用户事实。",
                target={"module_id": target_module_id},
                evidence_link_refs=[],
                action_templates=[],
            )
        )
    return issues


def _proposal_drafts(issues: list[RevisionIssueDraft]) -> list[RevisionProposalDraft]:
    proposals: list[RevisionProposalDraft] = []
    for issue in issues:
        if issue.type == "missing_opportunity_requirement":
            instruction = "如果你真实具备这项要求，请补充项目、工作经历或技能证据；否则保持简历不写该项。"
            summary = "补充岗位要求证据"
        else:
            instruction = "保持基础事实，不要为了匹配岗位而加入未经确认的经历或技能。"
            summary = "避免过度贴合"

        proposals.append(
            RevisionProposalDraft(
                target=issue.target,
                operation="insert_claim",
                after={"instruction": instruction},
                summary=summary,
                rationale="岗位版本必须以基础简历中的真实事实为边界。",
                evidence_link_refs=[],
                confidence=0.7,
                risk_level="medium",
                requires_user_confirmation=True,
                related_issue_refs=[issue.type],
            )
        )
    return proposals


def _match_summary(requirements: list[OpportunityRequirement]) -> MatchSummary:
    matched = sum(1 for requirement in requirements if requirement.evidence_status == "matched")
    partial = sum(1 for requirement in requirements if requirement.evidence_status == "partially_matched")
    missing = sum(1 for requirement in requirements if requirement.evidence_status == "missing")
    return MatchSummary(
        matched_count=matched,
        partial_count=partial,
        missing_count=missing,
        summary=f"岗位要求中 {matched} 项已匹配，{missing} 项缺少基础事实支撑。",
    )


def _requirement_tokens(raw_text: str) -> list[str]:
    tokens = re.findall(r"[A-Za-z][A-Za-z0-9+#.]*|[\u4e00-\u9fff]{2,}", raw_text)
    requirements: list[str] = []
    seen: set[str] = set()
    for token in tokens:
        normalized = token.strip(".,，。:：;；、").strip()
        if not normalized or normalized in STOPWORDS:
            continue
        key = normalized.lower()
        if key in seen:
            continue
        seen.add(key)
        requirements.append(normalized)
    return requirements[:12]


def _requirement_type(text: str) -> str:
    if re.search(r"[A-Za-z+#.]", text):
        return "skill"
    return "experience"


def _base_text(request: OpportunityCalibratorRunRequest) -> str:
    values = [
        *[_module_text(module) for module in request.modules],
        *[claim.text for claim in request.claims],
    ]
    return "\n".join(values)


def _module_text(module: DocumentModule) -> str:
    values: list[str] = [module.title]
    items = module.data.get("items")
    if isinstance(items, list):
        for item in items:
            if isinstance(item, str):
                values.append(item)
            elif isinstance(item, dict):
                values.extend(str(value) for value in item.values() if isinstance(value, str))
                bullets = item.get("bullets")
                if isinstance(bullets, list):
                    values.extend(str(bullet) for bullet in bullets if isinstance(bullet, str))
    else:
        values.extend(str(value) for value in module.data.values() if isinstance(value, str))
    return "\n".join(values)
