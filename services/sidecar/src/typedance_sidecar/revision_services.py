from uuid import uuid4

from .models import utc_now
from .revision_models import (
    Document,
    DraftVersion,
    EvidenceLink,
    ExportArtifact,
    ParsedBlock,
    QualityGateResult,
    RenderProjection,
    RevisionIssue,
    RevisionProposal,
    SourceDocument,
    UserConfirmation,
    WorkspaceView,
)
from .revision_render_projection import DraftProjectionBuilder
from .revision_repository import RevisionRepository


OPEN_ISSUE_STATUSES = {"open", "needs_user_input"}


class RevisionServiceError(Exception):
    pass


class SourceService:
    def __init__(self, repository: RevisionRepository) -> None:
        self.repository = repository

    def save_source(self, source: SourceDocument) -> SourceDocument:
        return self.repository.save_source_document(source)

    def save_parsed_block(self, block: ParsedBlock) -> ParsedBlock:
        return self.repository.save_parsed_block(block)

    def list_sources(self, document_id: str) -> list[SourceDocument]:
        return self.repository.list_source_documents(document_id)

    def list_parsed_blocks(self, source_document_id: str) -> list[ParsedBlock]:
        return self.repository.list_parsed_blocks(source_document_id)


class DraftService:
    def __init__(self, repository: RevisionRepository) -> None:
        self.repository = repository

    def save_draft(self, draft: DraftVersion) -> DraftVersion:
        return self.repository.save_draft_version(draft)

    def accept_draft(self, draft_id: str) -> DraftVersion:
        draft = self.repository.get_draft_version(draft_id)
        if draft is None:
            raise RevisionServiceError(f"Draft not found: {draft_id}")

        document = self.repository.get_document(draft.document_id)
        if document is None:
            raise RevisionServiceError(f"Document not found: {draft.document_id}")

        now = utc_now()
        accepted_draft = draft.model_copy(update={"status": "accepted", "updated_at": now})
        accepted_document = document.model_copy(
            update={
                "current_draft_id": draft.id,
                "accepted_draft_id": draft.id,
                "updated_at": now,
            }
        )
        self.repository.save_draft_version(accepted_draft)
        self.repository.save_document(accepted_document)
        return accepted_draft


class IssueService:
    def __init__(self, repository: RevisionRepository) -> None:
        self.repository = repository

    def save_issue(self, issue: RevisionIssue) -> RevisionIssue:
        return self.repository.save_revision_issue(issue)

    def list_issues(self, draft_id: str) -> list[RevisionIssue]:
        return self.repository.list_revision_issues(draft_id)

    def dismiss_issue(self, issue_id: str) -> RevisionIssue:
        issue = self.repository.get_revision_issue(issue_id)
        if issue is None:
            raise RevisionServiceError(f"Issue not found: {issue_id}")

        dismissed = issue.model_copy(update={"status": "dismissed"})
        return self.repository.save_revision_issue(dismissed)


class ProposalService:
    def __init__(self, repository: RevisionRepository) -> None:
        self.repository = repository

    def save_proposal(self, proposal: RevisionProposal) -> RevisionProposal:
        return self.repository.save_revision_proposal(proposal)

    def accept_proposal(self, proposal_id: str) -> RevisionProposal:
        proposal = self.repository.get_revision_proposal(proposal_id)
        if proposal is None:
            raise RevisionServiceError(f"Proposal not found: {proposal_id}")

        applied = proposal.model_copy(update={"status": "applied"})
        self.repository.save_revision_proposal(applied)

        if proposal.draft_id is not None:
            self._mark_proposal_applied_to_draft(proposal)

        for issue_id in proposal.related_issue_ids:
            issue = self.repository.get_revision_issue(issue_id)
            if issue is not None:
                self.repository.save_revision_issue(issue.model_copy(update={"status": "accepted"}))

        return applied

    def reject_proposal(self, proposal_id: str) -> RevisionProposal:
        proposal = self.repository.get_revision_proposal(proposal_id)
        if proposal is None:
            raise RevisionServiceError(f"Proposal not found: {proposal_id}")

        rejected = proposal.model_copy(update={"status": "rejected"})
        return self.repository.save_revision_proposal(rejected)

    def _mark_proposal_applied_to_draft(self, proposal: RevisionProposal) -> DraftVersion:
        draft = self.repository.get_draft_version(proposal.draft_id or "")
        if draft is None:
            raise RevisionServiceError(f"Draft not found: {proposal.draft_id}")

        applied_ids = [*draft.applied_proposal_ids]
        if proposal.id not in applied_ids:
            applied_ids.append(proposal.id)

        unresolved_issue_ids = [
            issue_id
            for issue_id in draft.unresolved_issue_ids
            if issue_id not in proposal.related_issue_ids
        ]
        updated_draft = draft.model_copy(
            update={
                "applied_proposal_ids": applied_ids,
                "unresolved_issue_ids": unresolved_issue_ids,
                "updated_at": utc_now(),
            }
        )
        return self.repository.save_draft_version(updated_draft)


class EvidenceService:
    def __init__(self, repository: RevisionRepository) -> None:
        self.repository = repository

    def confirm_claim(
        self,
        document_id: str,
        claim_id: str,
        *,
        issue_id: str | None = None,
        note: str | None = None,
        confirmation_id: str | None = None,
    ) -> UserConfirmation:
        confirmation = UserConfirmation(
            id=confirmation_id or f"confirm_{uuid4().hex}",
            document_id=document_id,
            claim_id=claim_id,
            issue_id=issue_id,
            confirmation_type="truth_confirmed",
            note=note,
            created_at=utc_now(),
        )
        return self.repository.save_user_confirmation(confirmation)

    def confirm_evidence_link(self, evidence_id: str) -> EvidenceLink:
        evidence = self.repository.get_evidence_link(evidence_id)
        if evidence is None:
            raise RevisionServiceError(f"Evidence link not found: {evidence_id}")

        confirmed = evidence.model_copy(update={"user_confirmed": True})
        return self.repository.save_evidence_link(confirmed)


class WorkspaceService:
    def __init__(self, repository: RevisionRepository) -> None:
        self.repository = repository

    def get_workspace_view(self, document_id: str) -> WorkspaceView:
        document = self.repository.get_document(document_id)
        if document is None:
            raise RevisionServiceError(f"Document not found: {document_id}")

        current_draft = self._current_draft(document)
        modules = []
        claims = []
        issues = []
        proposals = []
        render_projection = None

        if current_draft is not None:
            modules = self.repository.list_document_modules(current_draft.id)
            claims = self.repository.list_document_claims(current_draft.id)
            issues = self.repository.list_revision_issues(current_draft.id)
            proposals = self.repository.list_revision_proposals(current_draft.id)
            if current_draft.render_projection_id is not None:
                render_projection = self.repository.get_render_projection(current_draft.render_projection_id)

        return WorkspaceView(
            document=document,
            current_draft=current_draft,
            modules=modules,
            claims=claims,
            issues=issues,
            proposals=proposals,
            evidence=self.repository.list_evidence_links(document.id),
            source_summaries=self.repository.list_source_documents(document.id),
            render_projection=render_projection,
            quality_gate=self._quality_gate(current_draft, issues),
        )

    def _current_draft(self, document: Document) -> DraftVersion | None:
        if document.current_draft_id is not None:
            draft = self.repository.get_draft_version(document.current_draft_id)
            if draft is not None:
                return draft

        drafts = self.repository.list_draft_versions(document.id)
        return drafts[-1] if drafts else None

    def _quality_gate(
        self,
        current_draft: DraftVersion | None,
        issues: list[RevisionIssue],
    ) -> QualityGateResult:
        if current_draft is None:
            return QualityGateResult(status="unknown")

        open_issues = [issue for issue in issues if issue.status in OPEN_ISSUE_STATUSES]
        blocking_issue_ids = [
            issue.id
            for issue in open_issues
            if issue.severity == "blocking"
        ]
        warning_issue_ids = [
            issue.id
            for issue in open_issues
            if issue.severity in {"warning", "info"}
        ]

        if blocking_issue_ids:
            status = "blocked"
        elif warning_issue_ids:
            status = "needs_review"
        else:
            status = "ready"

        return QualityGateResult(
            status=status,
            blocking_issue_ids=blocking_issue_ids,
            warning_issue_ids=warning_issue_ids,
        )


class RenderService:
    def __init__(
        self,
        repository: RevisionRepository,
        projection_builder: DraftProjectionBuilder | None = None,
    ) -> None:
        self.repository = repository
        self.projection_builder = projection_builder or DraftProjectionBuilder()

    def save_projection(self, projection: RenderProjection) -> RenderProjection:
        return self.repository.save_render_projection(projection)

    def get_projection(self, projection_id: str) -> RenderProjection | None:
        return self.repository.get_render_projection(projection_id)

    def build_projection_for_draft(
        self,
        draft_id: str,
        *,
        render_profile: str | None = None,
    ) -> RenderProjection:
        draft = self.repository.get_draft_version(draft_id)
        if draft is None:
            raise RevisionServiceError(f"Draft not found: {draft_id}")

        modules = self.repository.list_document_modules(draft.id)
        projection = self.projection_builder.build(
            draft,
            modules,
            render_profile=render_profile,
        )
        self.repository.save_render_projection(projection)
        self.repository.save_draft_version(
            draft.model_copy(
                update={
                    "render_projection_id": projection.id,
                    "updated_at": utc_now(),
                }
            )
        )
        return projection


class ExportService:
    def __init__(self, repository: RevisionRepository) -> None:
        self.repository = repository

    def save_artifact(self, artifact: ExportArtifact) -> ExportArtifact:
        return self.repository.save_export_artifact(artifact)

    def list_artifacts(self, document_id: str) -> list[ExportArtifact]:
        return self.repository.list_export_artifacts(document_id)
