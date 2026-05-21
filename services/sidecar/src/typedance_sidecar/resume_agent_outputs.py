from typing import Any, Literal

from pydantic import BaseModel, Field

from .revision_agent_runtime import AgentSchemaRegistry, AgentWarning
from .revision_models import (
    ClaimConfidence,
    IssueSeverity,
    ModuleStatus,
    ModuleVisibility,
    RiskLevel,
    SupportLevel,
)


ConfidenceScore = float
ResumeModuleType = str
ResumeIssueType = str


class ParsedBlockDraft(BaseModel):
    type: Literal["heading", "paragraph", "list", "table", "contact", "date_range", "unknown"]
    text: str = Field(min_length=1)
    order: int = Field(ge=0)
    page: int | None = None
    source_span: dict[str, Any] = Field(default_factory=dict)
    confidence: ConfidenceScore = Field(ge=0, le=1)


class ParsedDocumentOutput(BaseModel):
    source_document_id: str = Field(min_length=1)
    blocks: list[ParsedBlockDraft] = Field(default_factory=list)
    detected_language: Literal["zh-CN", "en-US", "mixed", "unknown"] = "unknown"
    parse_warnings: list[AgentWarning] = Field(default_factory=list)


class DocumentModuleDraft(BaseModel):
    temp_id: str = Field(min_length=1)
    type: ResumeModuleType = Field(min_length=1)
    title: str = Field(min_length=1)
    order: int = Field(ge=0)
    visibility: ModuleVisibility
    status: ModuleStatus
    data: dict[str, Any] = Field(default_factory=dict)
    source_block_refs: list[str] = Field(default_factory=list)
    confidence: ConfidenceScore = Field(ge=0, le=1)


class DocumentClaimDraft(BaseModel):
    module_temp_id: str = Field(min_length=1)
    text: str = Field(min_length=1)
    claim_type: Literal[
        "responsibility",
        "achievement",
        "skill",
        "summary",
        "education",
        "certificate",
        "intent",
    ]
    source_block_refs: list[str] = Field(default_factory=list)
    confidence: Literal["supported", "inferred", "unsupported"]
    risk_flags: list[str] = Field(default_factory=list)
    item_temp_id: str | None = None


class ParsedBlockRef(BaseModel):
    block_id: str = Field(min_length=1)
    reason: str | None = None


class StructuredResumeOutput(BaseModel):
    modules: list[DocumentModuleDraft] = Field(default_factory=list)
    claims: list[DocumentClaimDraft] = Field(default_factory=list)
    unresolved_blocks: list[ParsedBlockRef] = Field(default_factory=list)
    structure_warnings: list[AgentWarning] = Field(default_factory=list)


class RevisionTarget(BaseModel):
    module_id: str | None = None
    module_type: str | None = None
    item_id: str | None = None
    claim_id: str | None = None
    field_path: str | None = None


class RevisionActionTemplate(BaseModel):
    action_type: str = Field(min_length=1)
    label: str = Field(min_length=1)
    target: RevisionTarget | None = None


class RevisionIssueDraft(BaseModel):
    type: ResumeIssueType = Field(min_length=1)
    severity: IssueSeverity
    title: str = Field(min_length=1)
    message: str = Field(min_length=1)
    reason: str = Field(min_length=1)
    target: RevisionTarget
    original_text: str | None = None
    suggested_direction: str | None = None
    evidence_link_refs: list[str] = Field(default_factory=list)
    action_templates: list[RevisionActionTemplate] = Field(default_factory=list)


class QualitySummary(BaseModel):
    status: Literal["unknown", "needs_review", "ready", "blocked"]
    blocking_count: int = Field(ge=0)
    warning_count: int = Field(ge=0)
    summary: str


class ResumeReviewOutput(BaseModel):
    issues: list[RevisionIssueDraft] = Field(default_factory=list)
    quality_summary: QualitySummary


class UserInputRequest(BaseModel):
    target: RevisionTarget
    question: str = Field(min_length=1)
    expected_answer_type: Literal[
        "short_text",
        "number",
        "date",
        "choice",
        "long_text",
    ]
    reason: str = Field(min_length=1)
    blocking: bool


class RevisionProposalDraft(BaseModel):
    target: RevisionTarget
    operation: Literal[
        "replace_claim",
        "insert_claim",
        "remove_claim",
        "rewrite_module",
        "reorder_module",
        "hide_module",
        "update_field",
    ]
    after: Any
    summary: str = Field(min_length=1)
    rationale: str = Field(min_length=1)
    evidence_link_refs: list[str] = Field(default_factory=list)
    confidence: ConfidenceScore = Field(ge=0, le=1)
    risk_level: RiskLevel
    requires_user_confirmation: bool
    related_issue_refs: list[str] = Field(default_factory=list)
    before: Any | None = None


class ResumeRewriteOutput(BaseModel):
    proposals: list[RevisionProposalDraft] = Field(default_factory=list)
    follow_up_questions: list[UserInputRequest] = Field(default_factory=list)


class EvidenceLinkDraft(BaseModel):
    claim_ref: str = Field(min_length=1)
    support_level: SupportLevel
    confidence: ConfidenceScore = Field(ge=0, le=1)
    requires_user_confirmation: bool
    source_document_ref: str | None = None
    parsed_block_refs: list[str] = Field(default_factory=list)
    extracted_text: str | None = None
    normalized_fact: str | None = None


class ClaimConfidenceUpdate(BaseModel):
    claim_ref: str = Field(min_length=1)
    confidence: ClaimConfidence
    reason: str = Field(min_length=1)


class EvidenceVerificationOutput(BaseModel):
    evidence_links: list[EvidenceLinkDraft] = Field(default_factory=list)
    claim_updates: list[ClaimConfidenceUpdate] = Field(default_factory=list)
    issues: list[RevisionIssueDraft] = Field(default_factory=list)


class OpportunityRequirement(BaseModel):
    type: Literal["skill", "experience", "domain", "seniority", "language", "education", "soft_skill"]
    text: str = Field(min_length=1)
    importance: Literal["required", "preferred", "nice_to_have"]
    evidence_status: Literal["matched", "partially_matched", "missing", "unknown"]


class MatchSummary(BaseModel):
    matched_count: int = Field(ge=0)
    partial_count: int = Field(ge=0)
    missing_count: int = Field(ge=0)
    summary: str = Field(min_length=1)


class DraftVariantPlan(BaseModel):
    title: str = Field(min_length=1)
    base_draft_ref: str = Field(min_length=1)
    variant_type: Literal["opportunity"] = "opportunity"
    proposal_refs: list[str] = Field(default_factory=list)
    risk_notes: list[str] = Field(default_factory=list)


class OpportunityCalibrationOutput(BaseModel):
    opportunity_requirements: list[OpportunityRequirement] = Field(default_factory=list)
    match_summary: MatchSummary
    issues: list[RevisionIssueDraft] = Field(default_factory=list)
    proposals: list[RevisionProposalDraft] = Field(default_factory=list)
    variant_plan: DraftVariantPlan


class LayoutWarning(BaseModel):
    code: str = Field(min_length=1)
    message: str = Field(min_length=1)
    severity: IssueSeverity = "warning"
    target: RevisionTarget | None = None


class RenderProjectionDraft(BaseModel):
    render_profile: str = Field(min_length=1)
    html: str | None = None
    doc_json: Any | None = None
    layout_warnings: list[LayoutWarning] = Field(default_factory=list)


class RenderPlanOutput(BaseModel):
    render_projection: RenderProjectionDraft
    layout_warnings: list[LayoutWarning] = Field(default_factory=list)
    compression_suggestions: list[RevisionIssueDraft] = Field(default_factory=list)


class ContextualAction(BaseModel):
    id: str = Field(min_length=1)
    label: str = Field(min_length=1)
    action_type: str = Field(min_length=1)
    target: RevisionTarget | None = None


class CoachNarrationOutput(BaseModel):
    summary: str = Field(min_length=1)
    next_best_actions: list[ContextualAction] = Field(default_factory=list)
    tone: Literal["calm", "encouraging", "warning", "direct"]


def resume_agent_output_schemas() -> dict[str, type[BaseModel]]:
    return {
        "ParsedDocumentOutput": ParsedDocumentOutput,
        "StructuredResumeOutput": StructuredResumeOutput,
        "ResumeReviewOutput": ResumeReviewOutput,
        "ResumeRewriteOutput": ResumeRewriteOutput,
        "EvidenceVerificationOutput": EvidenceVerificationOutput,
        "OpportunityCalibrationOutput": OpportunityCalibrationOutput,
        "RenderPlanOutput": RenderPlanOutput,
        "CoachNarrationOutput": CoachNarrationOutput,
    }


def register_resume_agent_output_schemas(
    registry: AgentSchemaRegistry,
) -> AgentSchemaRegistry:
    for output_type, model_type in resume_agent_output_schemas().items():
        registry.register(output_type, model_type)
    return registry
