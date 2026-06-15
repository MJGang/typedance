from typing import Any, Literal

from pydantic import BaseModel, Field

from .models import Language, utc_now


DocumentStatus = Literal["active", "archived"]
SourceType = Literal[
    "old_resume",
    "uploaded_file",
    "pasted_text",
    "manual_user_input",
    "project_material",
    "work_summary",
    "external_context",
]
ParseStatus = Literal[
    "pending",
    "initialized",
    "recognizing",
    "recognized",
    "recognition_failed",
]
ModuleVisibility = Literal["visible", "hidden"]
ModuleStatus = Literal["clean", "needs_review", "needs_confirmation", "weak", "hidden"]
ClaimConfidence = Literal["supported", "user_confirmed", "inferred", "unsupported"]
SupportLevel = Literal["direct", "partial", "inferred", "contradicted", "none"]
IssueSeverity = Literal["info", "warning", "blocking"]
IssueStatus = Literal["open", "resolved", "dismissed", "accepted", "needs_user_input"]
ProposalStatus = Literal["pending", "applied", "rejected", "edited", "superseded"]
RiskLevel = Literal["low", "medium", "high"]
DraftStatus = Literal["generated", "in_review", "accepted", "exported"]
DraftVariantType = Literal["base", "opportunity"]
ExportFormat = Literal["pdf", "html", "markdown", "docx"]
ExportArtifactStatus = Literal["succeeded"]


class Document(BaseModel):
    id: str
    pack_id: str
    title: str
    status: DocumentStatus
    target_language: Language
    current_draft_id: str | None = None
    accepted_draft_id: str | None = None
    created_at: str
    updated_at: str


class SourceDocument(BaseModel):
    id: str
    document_id: str
    source_type: SourceType
    title: str
    mime_type: str | None = None
    original_uri: str | None = None
    raw_text: str | None = None
    file_path: str | None = None
    parse_status: ParseStatus
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str


class ParsedBlock(BaseModel):
    id: str
    source_document_id: str
    type: Literal["heading", "paragraph", "list", "table", "contact", "date_range", "unknown"]
    text: str
    order: int
    page: int | None = None
    source_span: dict[str, Any] = Field(default_factory=dict)


SourceCanvasNodeType = Literal[
    "heading",
    "paragraph",
    "list_item",
    "table_cell",
    "divider",
    "unknown",
]


class SourceResumeCanvasNode(BaseModel):
    canvas_node_id: str = Field(min_length=1)
    node_type: SourceCanvasNodeType
    text: str
    source_block_id: str | None = Field(default=None, min_length=1)
    source_span: dict[str, Any] = Field(default_factory=dict)
    module_id: str | None = Field(default=None, min_length=1)


class ModuleAnchor(BaseModel):
    module_id: str = Field(min_length=1)
    canvas_node_ids: list[str] = Field(default_factory=list)
    title: str = Field(min_length=1)
    order: int = Field(ge=0)


class SourceResumeCanvas(BaseModel):
    id: str = Field(min_length=1)
    document_id: str = Field(min_length=1)
    old_resume_source_id: str = Field(min_length=1)
    version: int = Field(default=1, ge=1)
    source_snapshot_hash: str = Field(min_length=1)
    doc_json: dict[str, Any]
    node_map: list[SourceResumeCanvasNode] = Field(default_factory=list)
    module_anchors: list[ModuleAnchor] = Field(default_factory=list)
    created_at: str
    updated_at: str


class DraftVersion(BaseModel):
    id: str
    document_id: str
    run_id: str
    pack_id: str
    status: DraftStatus
    summary: str
    applied_proposal_ids: list[str] = Field(default_factory=list)
    unresolved_issue_ids: list[str] = Field(default_factory=list)
    render_projection_id: str | None = None
    variant_type: DraftVariantType = "base"
    created_at: str
    updated_at: str


class DocumentModule(BaseModel):
    id: str
    draft_id: str
    pack_id: str
    type: str
    title: str
    order: int
    visibility: ModuleVisibility
    status: ModuleStatus
    data: dict[str, Any] = Field(default_factory=dict)
    created_at: str
    updated_at: str


class DocumentClaim(BaseModel):
    id: str
    draft_id: str
    module_id: str
    text: str
    claim_type: str
    confidence: ClaimConfidence
    item_id: str | None = None
    risk_flags: list[str] = Field(default_factory=list)
    source_span_refs: list[str] = Field(default_factory=list)
    created_at: str
    updated_at: str


class EvidenceLink(BaseModel):
    id: str
    document_id: str
    source_document_id: str
    support_level: SupportLevel
    confidence: float
    user_confirmed: bool
    claim_id: str | None = None
    extracted_text: str | None = None
    normalized_fact: str | None = None
    created_at: str


class RevisionAction(BaseModel):
    id: str
    issue_id: str
    label: str
    action_type: str
    target: dict[str, Any] | None = None
    created_at: str = Field(default_factory=utc_now)
    updated_at: str = Field(default_factory=utc_now)


class RevisionIssue(BaseModel):
    id: str
    run_id: str
    document_id: str
    type: str
    severity: IssueSeverity
    title: str
    message: str
    reason: str
    status: IssueStatus
    created_by_agent: str
    created_at: str
    draft_id: str | None = None
    module_id: str | None = None
    item_id: str | None = None
    claim_id: str | None = None
    original_text: str | None = None
    proposed_text: str | None = None
    evidence_link_ids: list[str] = Field(default_factory=list)
    action_ids: list[str] = Field(default_factory=list)


class RevisionProposal(BaseModel):
    id: str
    run_id: str
    document_id: str
    target: dict[str, Any]
    operation: str
    proposed_snapshot: Any
    summary: str
    rationale: str
    confidence: float
    risk_level: RiskLevel
    requires_user_confirmation: bool
    status: ProposalStatus
    created_by_agent: str
    created_at: str
    draft_id: str | None = None
    original_snapshot: Any | None = None
    related_issue_ids: list[str] = Field(default_factory=list)
    evidence_link_ids: list[str] = Field(default_factory=list)


class UserConfirmation(BaseModel):
    id: str
    document_id: str
    confirmation_type: Literal["truth_confirmed", "risk_accepted", "source_verified"]
    claim_id: str | None = None
    evidence_link_id: str | None = None
    issue_id: str | None = None
    note: str | None = None
    created_at: str


class RenderProjection(BaseModel):
    id: str
    draft_id: str
    render_profile: str
    html: str | None = None
    doc_json: Any | None = None
    layout_warnings: list[dict[str, Any]] = Field(default_factory=list)
    created_at: str


class ExportArtifact(BaseModel):
    id: str
    document_id: str
    draft_id: str | None = None
    format: ExportFormat
    file_path: str | None = None
    status: ExportArtifactStatus
    created_at: str


class QualityGateResult(BaseModel):
    status: Literal["unknown", "needs_review", "ready", "blocked"]
    blocking_issue_ids: list[str] = Field(default_factory=list)
    warning_issue_ids: list[str] = Field(default_factory=list)


class CoachSummary(BaseModel):
    summary: str
    next_action_ids: list[str] = Field(default_factory=list)


class ContextualAction(BaseModel):
    id: str
    label: str
    action_type: str
    target: dict[str, Any] | None = None


class WorkspaceView(BaseModel):
    document: Document
    current_draft: DraftVersion | None = None
    modules: list[DocumentModule] = Field(default_factory=list)
    claims: list[DocumentClaim] = Field(default_factory=list)
    issues: list[RevisionIssue] = Field(default_factory=list)
    proposals: list[RevisionProposal] = Field(default_factory=list)
    evidence: list[EvidenceLink] = Field(default_factory=list)
    source_summaries: list[SourceDocument] = Field(default_factory=list)
    source_resume_canvas: SourceResumeCanvas | None = None
    render_projection: RenderProjection | None = None
    quality_gate: QualityGateResult | None = None
    coach_summary: CoachSummary | None = None
    available_actions: list[ContextualAction] = Field(default_factory=list)
